import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';

export function isLanIp(ip) {
  if (typeof ip !== 'string' || net.isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
export const modelNames = { 'BL-P001':'X1C', '3DPrinter-X1-Carbon':'X1C', 'BL-P002':'X1', '3DPrinter-X1':'X1', 'C11':'P1P', 'C12':'P1S', 'N1':'A1 mini', 'N2S':'A1', 'N6':'X2D' };
export function parseAnnouncement(text, ip) {
  if (!isLanIp(ip) || typeof text !== 'string' || text.length>16384) return null;
  const headers=new Map(text.split(/\r?\n/).flatMap(line=>{const at=line.indexOf(':');return at>0?[[line.slice(0,at).trim().toLowerCase(),line.slice(at+1).trim()]]:[];}));
  const get=key=>headers.get(`${key.toLowerCase()}.bambu.com`)||'';
  if(!get('DevModel')&&!get('DevId'))return null;
  const serial = (get('DevId')||headers.get('usn')||'').replace(/^uuid:/i,'').split('::')[0];
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(serial)) return null;
  const rawModel = get('DevModel');
  return { serial, ipAddress: ip, name: (get('DevName') || modelNames[rawModel] || rawModel).slice(0,80),
    model: modelNames[rawModel] || rawModel, rawModel, source: 'bambu-ssdp' };
}
export async function discover({ durationMs = 10000, interfaces=lanInterfaces(), onDiagnostic=()=>{} } = {}) {
  const found = new Map();
  if(!interfaces.length)return [];
  await Promise.all([0, 1990, 2021].map(port => new Promise(resolve => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false, repeat;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); clearInterval(repeat); try { socket.close(resolve); } catch { resolve(); } };
    const timer = setTimeout(finish, durationMs);
    socket.on('error', error=>{onDiagnostic({port,code:error.code||'UDP'});finish();});
    socket.on('message', (buffer, remote) => {
      const printer = parseAnnouncement(buffer.toString('utf8'), remote.address);
      if (printer) found.set(printer.serial, printer);
    });
    socket.bind(port, '0.0.0.0', () => {
      if (done) return;
      for (const intf of interfaces) { try { socket.addMembership('239.255.255.250', intf.address); } catch {} }
      if (port !== 0) return;
      socket.setMulticastTTL(1);socket.setBroadcast(true);
      const query = () => { for (const queryPort of [1900, 1990, 2021]) {
        const packet = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:${queryPort}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n`);
        for (const intf of interfaces) {
          try { socket.setMulticastInterface(intf.address); socket.send(packet, queryPort, '239.255.255.250', () => {});
            if(intf.broadcast)socket.send(packet,queryPort,intf.broadcast,()=>{});
          } catch {}
        }
      } };
      query();repeat=setInterval(query,2500);
    });
  })));
  return [...found.values()].sort((a,b) => a.name.localeCompare(b.name));
}

const ipNumber=ip=>ip.split('.').reduce((n,b)=>(n*256+Number(b))>>>0,0);
const numberIp=n=>[24,16,8,0].map(shift=>(n>>>shift)&255).join('.');
export function lanInterfaces(input=os.networkInterfaces()) {
  const seen=new Set(),out=[];
  for(const [name,entries]of Object.entries(input))for(const entry of entries||[]) {
    if(entry.family!=='IPv4'||entry.internal||!isLanIp(entry.address)||entry.address.startsWith('127.')||net.isIP(entry.netmask)!==4||seen.has(entry.address))continue;
    const mask=ipNumber(entry.netmask),bits=mask.toString(2).padStart(32,'0');
    if(!/^1+0*$/.test(bits))continue;
    const prefix=bits.indexOf('0')<0?32:bits.indexOf('0');
    if(prefix>30)continue;
    const address=ipNumber(entry.address),network=(address&mask)>>>0;
    const broadcast=numberIp((network|(~mask>>>0))>>>0);
    seen.add(entry.address);out.push({name,address:entry.address,netmask:entry.netmask,prefix,network:`${numberIp(network)}/${prefix}`,broadcast});
  }
  return out;
}

// A bounded, read-only check of MQTT's TLS port. An open port is NOT a printer identity.
export function scanTargets(interfaces,maxHosts=512) {
  const own=new Set(interfaces.map(i=>i.address)),targets=new Set();let limited=false;
  for(const intf of interfaces) {
    const prefix=Math.max(intf.prefix,24),mask=(0xffffffff << (32-prefix))>>>0;
    const start=(ipNumber(intf.address)&mask)>>>0,end=start+2**(32-prefix)-1;
    if(prefix!==intf.prefix)limited=true;
    for(let host=start+1;host<end;host++) {
      const ip=numberIp(host);if(own.has(ip)||!isLanIp(ip)||ip.startsWith('127.'))continue;
      if(targets.size>=maxHosts){limited=true;break;}
      targets.add(ip);
    }
  }
  return {targets:[...targets],limited};
}
export function probeMqttPort(ip,timeoutMs=450) {
  if(!isLanIp(ip)||ip.startsWith('127.'))return Promise.resolve(false);
  return new Promise(resolve=>{
    let done=false;const socket=new net.Socket();
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(result);};
    const timer=setTimeout(()=>finish(false),timeoutMs);
    socket.once('error',()=>finish(false));socket.once('connect',()=>finish(true));
    socket.connect({host:ip,port:8883});
  });
}
export async function scanMqttHosts(targets,{probe=probeMqttPort,concurrency=24}={}) {
  let cursor=0;const open=[];
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},async()=>{
    while(cursor<targets.length){const ip=targets[cursor++];try{if(await probe(ip))open.push(ip);}catch{}}
  }));
  return open.sort((a,b)=>ipNumber(a)-ipNumber(b));
}
