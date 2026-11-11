import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,stat,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture,writeArchive,startInput,fresh } from './helpers.mjs';
import { inspectArchive } from '../src/archive.mjs';
import { createApi } from '../src/api.mjs';
import { buildStart } from '../src/commands.mjs';

test('3MF inspection reads sliced plates, model, nozzle and per-filament metadata',async t=>{
  const f=await fixture(t),file=path.join(f.dir,'sample.gcode.3mf');await writeArchive(file);
  const info=await inspectArchive(file);assert.equal(info.plates[0].model,'P1S');assert.deepEqual(info.plates[0].nozzleDiameters,[0.4]);
  assert.equal(info.plates[0].filaments[0].grams,30);assert.equal(info.sha256.length,64);
  f.transport.uploadBytes=(await stat(file)).size;const transfer=await f.service.upload(f.printer.id,file);assert.equal(transfer.status,'uploaded');
  assert.match(transfer.remoteName,/^harv-hudson-[a-f0-9-]+\.gcode\.3mf$/);
});
test('unsliced, malformed and incompatible files never become printable',async t=>{
  const f=await fixture(t),file=path.join(f.dir,'bad.3mf');
  await writeArchive(file,{sliced:false});await assert.rejects(inspectArchive(file),{code:'UNSLICED'});
  await writeFile(file,'not a zip');await assert.rejects(inspectArchive(file),{code:'INVALID_3MF'});
  await writeArchive(file,{model:'A1'});await assert.rejects(f.service.upload(f.printer.id,file),{code:'WRONG_MODEL'});
  await writeArchive(file);f.transport.uploadBytes=1;await assert.rejects(f.service.upload(f.printer.id,file),{code:'UPLOAD_SIZE'});
});
test('X2D requires explicit nozzle assignment and supports AMS plus an identified external source',()=>{
  const transfer={remoteName:'hudson-test.gcode.3mf',archive:{plates:[{index:1,param:'Metadata/plate_1.gcode',model:'X2D',nozzleDiameters:[0.4,0.4],filaments:[{id:1,type:'PETG'},{id:2,type:'TPU'}]}]}};
  const printer={model:'X2D',nozzleDiameters:[0.4,0.4]};
  const status=fresh({slots:[{amsId:0,slotId:1,source:'ams',material:'PETG',empty:false},{amsId:254,slotId:0,source:'external',material:'TPU',empty:false}]});
  const input={...startInput,filamentMapping:[{amsId:0,slotId:1},{amsId:254,slotId:0}],nozzleMapping:[0,1]};
  const packet=buildStart({printer,transfer,status,input,sequence:'20001',operationId:'test'});
  assert.deepEqual(packet.print.ams_mapping,[1,-1]);assert.deepEqual(packet.print.ams_mapping2,[{ams_id:0,slot_id:1},{ams_id:254,slot_id:0}]);
  assert.deepEqual(packet.print.nozzle_mapping,[0,1]);assert.equal(packet.print.url,'ftp:///hudson-test.gcode.3mf');
  assert.throws(()=>buildStart({printer,transfer,status,input:{...input,nozzleMapping:undefined},sequence:'20002',operationId:'test'}),{code:'NOZZLE_MAPPING'});
  assert.throws(()=>buildStart({printer:{...printer,nozzleDiameters:[0.4,0.6]},transfer,status,input,sequence:'20003',operationId:'test'}),{code:'WRONG_NOZZLE'});
});
test('HTTP API protects private endpoints, rejects other browser origins and controls one print per request key',async t=>{
  const f=await fixture(t),token='test-token-only';
  const server=createApi({...f,token,discovery:async()=>[]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,method='GET',body,extra={})=>fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/api/printers')).status,401);
  assert.equal((await call('/api/printers','GET',undefined,{Origin:'https://untrusted.example'})).status,403);
  const printers=await(await call('/api/printers')).json();assert.equal(printers.printers.length,1);assert.ok(!JSON.stringify(printers).includes('test-code'));
  const route=`/api/printers/${f.printer.id}/commands/start`;
  assert.equal((await call(route,'POST',startInput)).status,400);
  for(let i=0;i<2;i++)assert.equal((await call(route,'POST',startInput,{'Idempotency-Key':'http-start-01'})).status,202);
  assert.equal(f.transport.calls.length,1);
});
test('HTTP binary upload is parsed, verified and temporary upload bytes are removed',async t=>{
  const f=await fixture(t),token='upload-test-token';const server=createApi({...f,token});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const file=path.join(f.dir,'plate.gcode.3mf');await writeArchive(file);const bytes=await readFile(file);f.transport.uploadBytes=bytes.length;
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/printers/${f.printer.id}/uploads`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:bytes});
  assert.equal(response.status,201);const {transfer}=await response.json();assert.equal(transfer.status,'uploaded');assert.equal(transfer.bytes,bytes.length);
});
