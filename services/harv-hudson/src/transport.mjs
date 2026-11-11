import mqtt from 'mqtt';
import { EventEmitter } from 'node:events';
import { Client } from 'basic-ftp';
import { requireThat } from './errors.mjs';
import { mergeReport,normalizeTelemetry,hasTelemetry } from './telemetry.mjs';
import {hasCompleteFilamentReport} from '../public/filament-access.js';

export class BambuTransport extends EventEmitter {
  constructor({store,vault,config,mqttConnect=mqtt.connect,ftpFactory=()=>new Client(20_000)}) { super(); Object.assign(this,{store,vault,config,mqttConnect,ftpFactory}); this.sessions = new Map(); }
  async connect(printer) {
    await this.disconnect(printer.id);
    const saved = this.store.telemetry(printer.id) || {};
    const session = {printer,raw:saved.raw || {},lastSeenAt:saved.lastSeenAt || null,stateSeenAt:null,connected:false,synchronized:false,connectionState:'connecting',firmware:saved.firmware || null};
    this.sessions.set(printer.id,session);
    if (this.config.mqttDisabled) { session.connectionState='disabled'; return; }
    let password;
    try { password = await this.vault.unprotect(this.store.secret(printer.id)); }
    catch { session.connectionState='credential-error'; this.emit('connection',printer.id,session.connectionState); return; }
    // Local Bambu printers use appliance certificates, not publicly trusted roots.
    // The destination is a validated private IP, never a public hostname.
    const client = this.mqttConnect({protocol:'mqtts',host:printer.ipAddress,port:printer.mqttPort || 8883,
      username:'bblp',password,rejectUnauthorized:false,clientId:`hudson_${printer.id}_${process.pid}`,
      protocolVersion:4,clean:true,connectTimeout:8000,reconnectPeriod:10000,queueQoSZero:false,keepalive:30});
    session.client = client;
    const current = () => this.sessions.get(printer.id) === session;
    client.on('connect', () => {
      if (!current()) return;
      session.connected=true; session.synchronized=false; session.stateSeenAt=null; session.connectionState='synchronizing';
      // Discard persisted deltas on each new session, then request a fresh baseline.
      session.raw={};session.filamentSeen={};
      client.subscribe(`device/${printer.serial}/report`, {qos:0}, error => {
        if (error) { session.connectionState='subscribe-error'; return; }
        this.refresh(printer.id);
        this.sendRead(session,{info:{sequence_id:this.store.nextSequence(),command:'get_version'}});
      });
      this.emit('connection',printer.id,session.connectionState);
    });
    const offline = () => {
      if (!current()) return;
      session.connected=false;session.synchronized=false;session.stateSeenAt=null;session.connectionState='offline';
      this.emit('connection',printer.id,'offline');
    };
    client.on('close',offline); client.on('offline',offline);
    client.on('error', () => { if (current()) this.emit('diagnostic',printer.id,'mqtt-error'); });
    client.on('message', (topic,bytes) => {
      if (!current() || topic !== `device/${printer.serial}/report` || bytes.length > 2*1024*1024) return;
      let message; try { message=JSON.parse(bytes.toString('utf8')); } catch { return; }
      if (!message||typeof message!=='object') return;
      if (Array.isArray(message.info?.module)) session.firmware=message.info.module.filter(m=>m&&typeof m==='object').map(m=>({name:m.name,version:m.sw_ver}));
      const print = message.print;
      if (hasTelemetry(print)) {
        session.raw=mergeReport(session.raw,print);
        session.lastSeenAt=new Date().toISOString();
        session.filamentSeen??={};
        for(const mode of ['legacy','extruder'])if(hasCompleteFilamentReport(print,mode))session.filamentSeen[mode]=session.lastSeenAt;
        if (Object.hasOwn(print,'gcode_state')) { session.synchronized=true;session.stateSeenAt=session.lastSeenAt; }
        session.connectionState=session.synchronized ? 'connected' : 'synchronizing';
        this.store.saveTelemetry(printer.id,{raw:session.raw,lastSeenAt:session.lastSeenAt,firmware:session.firmware});
        this.emit('telemetry',printer.id,this.status(printer.id));
      }
      if (print?.command && (print.result !== undefined || print.reason !== undefined)) this.emit('ack',printer.id,print);
    });
    session.poll = setInterval(() => this.refresh(printer.id),30_000); session.poll.unref();
  }
  sendRead(session,packet) { if (session.client?.connected) session.client.publish(`device/${session.printer.serial}/request`,JSON.stringify(packet),{qos:0},()=>{}); }
  refresh(id) {
    const s=this.sessions.get(id); if (!s) return;
    this.sendRead(s,{pushing:{sequence_id:this.store.nextSequence(),command:'pushall'}});
  }
  status(id) {
    const s=this.sessions.get(id);
    const saved=this.store.telemetry(id) || {};
    const data=s || saved;
    const fresh=Boolean(s?.connected && s.synchronized && s.stateSeenAt && Date.now()-Date.parse(s.stateSeenAt)<this.config.staleMs);
    const telemetry=normalizeTelemetry(data.raw),filamentSeenAt=s?.filamentSeen?.[telemetry.filamentUse.mode];
    return {...telemetry,filamentUseFresh:!!(fresh&&filamentSeenAt&&Date.now()-Date.parse(filamentSeenAt)<this.config.staleMs),connectionState:s?.connectionState || 'offline',fresh,
      lastSeenAt:data.lastSeenAt || null,stateSeenAt:s?.stateSeenAt || null,firmware:data.firmware || null};
  }
  async publish(id,packet) {
    const s=this.sessions.get(id);
    requireThat(s?.client?.connected,'OFFLINE','La impresora no está conectada.',409);
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('Tiempo de envío agotado; resultado desconocido.')),8000);
      s.client.publish(`device/${s.printer.serial}/request`,JSON.stringify(packet),{qos:0,retain:false},error=>{
        clearTimeout(timer); error ? reject(new Error('No se pudo confirmar el envío MQTT.')) : resolve();
      });
    });
  }
  async probeStorage(printer) {
    return this.#ftp(printer, async client => ({available:true,root:await client.pwd()}));
  }
  async upload(printer,localFile,remoteName) {
    return this.#ftp(printer,async client => {
      await client.uploadFrom(localFile,remoteName);
      return {bytes:await client.size(remoteName)};
    });
  }
  async #ftp(printer,callback) {
    const client = this.ftpFactory();
    try {
      await client.access({host:printer.ipAddress,port:printer.ftpPort || 990,user:'bblp',password:await this.vault.unprotect(this.store.secret(printer.id)),secure:'implicit',secureOptions:{rejectUnauthorized:false}});
      return await callback(client);
    } finally { client.close(); }
  }
  async disconnect(id) {
    const s=this.sessions.get(id);if (!s) return;
    this.sessions.delete(id);clearInterval(s.poll);
    if (s.client) { s.client.removeAllListeners(); await s.client.endAsync(true); }
  }
  async close() { for (const id of [...this.sessions.keys()]) await this.disconnect(id); }
}
