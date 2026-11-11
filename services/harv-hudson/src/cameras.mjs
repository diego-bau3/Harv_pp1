import tls from 'node:tls';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { projectDir } from './config.mjs';
import { isLanIp } from './discovery.mjs';

const MAX_FRAME=4*1024*1024;
const isJpeg=b=>b.length>=4&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217;

// P1/A1 send a 16-byte little-endian header followed by a complete JPEG.
// TCP/TLS chunks need not align with either header or frame boundaries.
export class CameraFrames {
  constructor(onFrame,{framed=true,maxBytes=MAX_FRAME}={}) {Object.assign(this,{onFrame,framed,maxBytes});this.buffer=Buffer.alloc(0);}
  push(chunk) {
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length) {
      if(this.framed) {
        if(this.buffer.length<16)break;
        const size=this.buffer.readUInt32LE(0);
        if(size<4||size>this.maxBytes||this.buffer.readUInt32LE(4)!==0||this.buffer.readUInt32LE(8)!==1)throw new Error('Camera frame rejected');
        if(this.buffer.length<size+16)break;
        const frame=this.buffer.subarray(16,size+16);this.buffer=this.buffer.subarray(size+16);
        if(!isJpeg(frame))throw new Error('Invalid camera JPEG');
        this.onFrame(Buffer.from(frame));
      } else {
        if(this.buffer.length>=2&&(this.buffer[0]!==255||this.buffer[1]!==216))throw new Error('Invalid JPEG stream');
        const end=this.buffer.indexOf(Buffer.from([255,217]),2);
        if(end<0)break;
        if(end+2>this.maxBytes)throw new Error('Camera frame too large');
        this.onFrame(Buffer.from(this.buffer.subarray(0,end+2)));this.buffer=this.buffer.subarray(end+2);
      }
    }
    if(this.buffer.length>this.maxBytes+16)throw new Error('Camera buffer too large');
  }
}

export function cameraPlan(printer,raw={}) {
  if(!isLanIp(printer.ipAddress))return {state:'unavailable',message:'Revisa la dirección local de esta impresora.'};
  if(raw.ipcam?.ipcam_dev==='0')return {state:'unavailable',message:'La impresora no detecta su cámara.'};
  if(['P1S','A1'].includes(printer.model))return {kind:'jpeg',port:6000};
  if(!['X1C','X2D'].includes(printer.model))return {state:'unavailable',message:'Cámara no compatible.'};
  if(raw.ipcam?.rtsp_url==='disable')return {state:'disabled',message:'Activa la cámara LAN en la impresora.'};
  // Never follow arbitrary URLs from telemetry; credentials and destination are
  // bound to the printer already linked in Hudson.
  return {kind:'rtsps',port:322};
}

export function cameraAuth(password) {
  if(typeof password!=='string'||!password.length||Buffer.byteLength(password)>32)throw new Error('Invalid camera credential');
  const auth=Buffer.alloc(80);auth.writeUInt32LE(0x40);auth.writeUInt32LE(0x3000,4);auth.write('bblp',16);auth.write(password,48);return auth;
}

export function openCamera({printer,password,plan,onFrame,onEnd,ffmpegPath,tlsConnect=tls.connect,spawnProcess=spawn}) {
  let stopped=false;
  const end=()=>{if(!stopped){stopped=true;onEnd();}};
  if(plan.kind==='jpeg') {
    const auth=cameraAuth(password),decoder=new CameraFrames(onFrame);
    const socket=tlsConnect({host:printer.ipAddress,port:6000,rejectUnauthorized:false},()=>{socket.write(auth);auth.fill(0);});
    socket.setTimeout(12_000,()=>{socket.destroy();end();});
    socket.on('data',chunk=>{try{decoder.push(chunk);}catch{socket.destroy();end();}});
    socket.on('error',end);socket.on('close',end);
    return {close(){stopped=true;auth.fill(0);socket.destroy();}};
  }
  const decoder=new CameraFrames(onFrame,{framed:false});
  const child=spawnProcess(ffmpegPath,['-hide_banner','-loglevel','quiet','-nostdin',
    '-f','concat','-safe','0','-protocol_whitelist','file,pipe,rtp,udp,tcp,tls,crypto','-i','pipe:0',
    '-an','-sn','-vf','fps=2,scale=640:-2','-threads','1','-filter_threads','1','-q:v','5','-f','image2pipe','-c:v','mjpeg','pipe:1'],
    {windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,FFREPORT:''}});
  // The authenticated URL travels only over stdin, not argv, disk or logs.
  const url=`rtsps://bblp:${encodeURIComponent(password).replace(/'/g,'%27')}@${printer.ipAddress}:322/streaming/live/1`;
  child.stdin.on('error',()=>{});
  child.stdin.end(`ffconcat version 1.0\nfile '${url}'\noption rtsp_transport tcp\noption tls_verify 0\noption timeout 10000000\n`);
  child.stdout.on('data',chunk=>{try{decoder.push(chunk);}catch{child.kill();end();}});
  child.on('error',end);child.on('close',end);
  return {close(){stopped=true;child.kill();}};
}

export class CameraService {
  constructor({store,vault,open=openCamera,clock=Date.now,ffmpegPath=path.join(projectDir,'tools','ffmpeg','ffmpeg.exe'),available=existsSync,
    idleMs=15_000,freshMs=10_000,retryMs=15_000,startMs=20_000}) {
    Object.assign(this,{store,vault,open,clock,ffmpegPath,available,idleMs,freshMs,retryMs,startMs});
    this.entries=new Map();this.closed=false;
    this.timer=setInterval(()=>this.sweep(),1000);this.timer.unref();
  }
  snapshot(printer) {
    if(this.closed)return {state:'unavailable',message:'Agente reiniciando.'};
    const plan=cameraPlan(printer,this.store.telemetry(printer.id)?.raw);
    if(!plan.kind){this.stop(printer.id);return plan;}
    if(plan.kind==='rtsps'&&!this.available(this.ffmpegPath))return {state:'unavailable',message:'Falta el componente de cámara en esta PC.'};
    const signature=JSON.stringify([printer.ipAddress,plan.kind,this.store.secret(printer.id)]);
    let e=this.entries.get(printer.id);
    if(e&&e.signature!==signature){this.stop(printer.id);e=null;}
    if(!e){e={signature,lastRequest:this.clock(),state:'connecting',frame:null,at:0,retryAt:0,startedAt:0,receiver:null,starting:false};this.entries.set(printer.id,e);}
    e.lastRequest=this.clock();
    if(!e.starting&&!e.receiver&&this.clock()>=e.retryAt)this.start(printer,plan,e);
    if(e.state==='live'&&e.frame&&this.clock()-e.at<=this.freshMs)return {state:'live',frame:e.frame,at:e.at};
    return {state:e.state==='live'?'connecting':e.state,message:e.state==='unavailable'?'Cámara sin señal. Reintentando…':'Conectando cámara…'};
  }
  async start(printer,plan,e) {
    e.starting=true;e.state='connecting';e.startedAt=this.clock();
    const current=()=>!this.closed&&this.entries.get(printer.id)===e;
    const fail=()=>{if(!current())return;e.receiver?.close();e.receiver=null;e.starting=false;e.frame=null;e.state='unavailable';e.retryAt=this.clock()+this.retryMs;};
    try {
      const password=await this.vault.unprotect(this.store.secret(printer.id));
      if(!current())return;
      e.receiver=this.open({printer,password,plan,ffmpegPath:this.ffmpegPath,
        onFrame:frame=>{if(current()){e.frame=frame;e.at=this.clock();e.state='live';}},onEnd:fail});
      e.starting=false;
    } catch {fail();}
  }
  sweep() {
    for(const [id,e]of this.entries) {
      const now=this.clock();
      if(now-e.lastRequest>this.idleMs){this.stop(id);continue;}
      if((e.receiver||e.starting)&&now-(e.at||e.startedAt)>this.startMs){this.stop(id);}
    }
  }
  stop(id){const e=this.entries.get(id);this.entries.delete(id);e?.receiver?.close();}
  close(){this.closed=true;clearInterval(this.timer);for(const id of this.entries.keys())this.stop(id);}
}
