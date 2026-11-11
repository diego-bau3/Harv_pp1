import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnnouncement,lanInterfaces,scanTargets,scanMqttHosts } from '../src/discovery.mjs';
import { PrinterDiscovery } from '../src/printer-discovery.mjs';
import { parseStudioCredentials,readStudioCredentials } from '../src/studio-devices.mjs';
import { fixture } from './helpers.mjs';
import { createApi } from '../src/api.mjs';
import { discoveryPanel } from '../public/discovery.js';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';

const networks=()=>lanInterfaces({'Wi-Fi':[{family:'IPv4',internal:false,address:'192.168.100.9',netmask:'255.255.255.0'}]});
test('Bambu announcements accept actual USN identities, legacy DevId and X1 model names',()=>{
  for(const [raw,model]of [['3DPrinter-X1-Carbon','X1C'],['C12','P1S'],['N2S','A1'],['N6','X2D']]) {
    const found=parseAnnouncement(`HTTP/1.1 200 OK\r\nUSN: uuid:TESTSERIAL123::urn:bambulab-com:device:3dprinter:1\r\nDevModel.bambu.com: ${raw}\r\nDevName.bambu.com: My printer\r\nLocation: 8.8.8.8\r\n`,'192.168.100.22');
    assert.equal(found.serial,'TESTSERIAL123');assert.equal(found.model,model);assert.equal(found.ipAddress,'192.168.100.22');
  }
  assert.equal(parseAnnouncement('USN: TESTSERIAL123\r\nSERVER: generic','192.168.100.22'),null);
  assert.equal(parseAnnouncement('DevId.bambu.com: TESTSERIAL123','8.8.8.8'),null);
  assert.equal(parseAnnouncement('USN: bad:serial\r\nDevModel.bambu.com: N6','192.168.100.22'),null);
  assert.equal(parseAnnouncement('DevId.bambu.com: LEGACY123\nDevModel.bambu.com: N6','192.168.100.22').serial,'LEGACY123');
});
test('network scan stays inside private subnets, excludes self/network/broadcast and limits large networks',()=>{
  const result=scanTargets(networks());assert.equal(result.targets.length,253);
  assert.ok(!result.targets.includes('192.168.100.9'));assert.ok(!result.targets.includes('192.168.100.0'));assert.ok(!result.targets.includes('192.168.100.255'));assert.equal(result.limited,false);
  const large=lanInterfaces({a:[{family:'IPv4',address:'10.12.20.4',netmask:'255.0.0.0'}],b:[{family:'IPv4',address:'8.8.8.1',netmask:'255.255.255.0'}],bad:[{family:'IPv4',address:'192.168.1.2',netmask:'255.0.255.0'}]});
  assert.equal(large.length,1);const bounded=scanTargets(large,20);assert.equal(bounded.targets.length,20);assert.equal(bounded.limited,true);assert.ok(bounded.targets.every(ip=>ip.startsWith('10.12.20.')));
  assert.deepEqual(scanTargets([]),{targets:[],limited:false});
});
test('probe work is bounded, failures settle and duplicate requests share a search',async()=>{
  let active=0,peak=0;
  const open=await scanMqttHosts(['192.168.1.1','192.168.1.2','192.168.1.3'],{concurrency:2,probe:async ip=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(ip.endsWith('.2'))throw Error('offline');return ip.endsWith('.3');}});
  assert.deepEqual(open,['192.168.1.3']);assert.equal(peak,2);
  let calls=0;
  const finder=new PrinterDiscovery({store:{printers:()=>[]},config:{},interfaces:networks,credentials:async()=>new Map([['TESTSERIAL123','SECRET-DO-NOT-EXPOSE']]),
    announce:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return [{serial:'TESTSERIAL123',ipAddress:'192.168.100.21',model:'P1S',name:'P1S',accessCode:'SECRET-DO-NOT-EXPOSE'}];},scan:async()=>['192.168.100.21','192.168.100.50','8.8.8.8']});
  const a=finder.run(),b=finder.run();assert.equal(a,b);assert.equal(finder.status().running,true);
  const result=await a;assert.equal(calls,1);assert.equal(finder.status().running,false);assert.equal(result.printers[0].hasSavedAccessCode,true);
  assert.deepEqual(result.unidentified,[{ipAddress:'192.168.100.50',source:'mqtt-port',name:'Equipo por identificar'}]);
  assert.ok(!JSON.stringify(result).includes('SECRET'));await finder.run();assert.equal(calls,1);
  await finder.run({force:true});assert.equal(calls,2);
});
test('saved Studio codes handle comments and fallback profiles without exposing invalid entries',async t=>{
  const codes=parseStudioCredentials('\uFEFF{"access_code":{"SERIAL123":"first-code","INVALID":""},"user_access_code":{"SERIAL123":"new-code"}}\n# checksum');
  assert.equal(codes.size,1);assert.equal(codes.get('SERIAL123'),'new-code');
  const f=await fixture(t),appData=path.join(f.dir,'appdata');await mkdir(path.join(appData,'BambuStudio'),{recursive:true});
  await writeFile(path.join(appData,'BambuStudio','BambuStudio.conf'),'not a complete JSON file');
  assert.equal((await readStudioCredentials({dataDir:f.dir,appData})).size,0);
  await writeFile(path.join(appData,'BambuStudio','BambuStudio.conf'),' {"access_code":{"SERIAL123":"saved-code"}}\n# MD5');
  assert.equal((await readStudioCredentials({dataDir:f.dir,appData})).get('SERIAL123'),'saved-code');
});
test('authenticated discovery never registers devices; selected saved code is protected only when linking',async t=>{
  const f=await fixture(t),token='test-discovery-auth';
  const candidate={serial:'NEWTESTSERIAL',ipAddress:'192.168.1.25',model:'A1',name:'A1 test'};
  const credentials=async()=>new Map([[candidate.serial,'SAVED-SECRET']]);
  const finder=new PrinterDiscovery({store:f.store,config:f.config,announce:async()=>[candidate],interfaces:()=>[],scan:async()=>[],credentials});
  const server=createApi({...f,token,discoveryService:finder,studioCredentials:credentials});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/discovery')).status,401);
  const r=await fetch(base+'/api/discovery',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);
  const body=await r.text();assert.ok(!body.includes('SAVED-SECRET'));assert.equal(JSON.parse(body).printers[0].serial,candidate.serial);
  assert.equal(f.store.printers().length,1);assert.equal(f.transport.calls.length,0);
  let linked=await fetch(base+'/api/printers',{method:'POST',headers,body:JSON.stringify({...candidate,nozzleDiameters:[0.4],useSavedAccessCode:true})});
  assert.equal(linked.status,201);const result=await linked.json();assert.equal(f.store.secret(result.printer.id),'test-protected:SAVED-SECRET');assert.ok(!JSON.stringify(result).includes('SAVED-SECRET'));
  linked=await fetch(base+'/api/printers',{method:'POST',headers,body:JSON.stringify({...candidate,serial:'NOSAVEDCODE',useSavedAccessCode:true,nozzleDiameters:[0.4]})});
  assert.equal(linked.status,400);assert.equal((await linked.json()).error,'STUDIO_CODE_MISSING');assert.equal(f.transport.calls.length,0);
});
test('discovery errors allow retry and UI distinguishes unknown ports while escaping advertised names',async()=>{
  let fail=true;const finder=new PrinterDiscovery({store:{printers:()=>[]},config:{},interfaces:()=>[],scan:async()=>[],credentials:async()=>new Map(),announce:async()=>{if(fail)throw Error('network down');return [];}});
  await assert.rejects(finder.run());assert.equal(finder.status().running,false);assert.ok(finder.status().error);fail=false;assert.deepEqual((await finder.run()).printers,[]);
  const html=discoveryPanel({busy:false,result:{printers:[{name:'<img onerror=alert(1)>',model:'A1',serial:'SERIAL123',ipAddress:'192.168.1.4',supported:true}],unidentified:[{ipAddress:'192.168.1.5'}],networks:[],warnings:[],savedCount:0}},{button:()=>'',icon:()=>'',modelLabel:m=>m});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('no anunciaron una identidad Bambu'));
});
