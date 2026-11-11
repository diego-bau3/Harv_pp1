import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile,writeFile,stat,readdir } from 'node:fs/promises';
import { fixture,fresh,writeArchive,FakeTransport,fakeVault,startInput } from './helpers.mjs';
import { Store } from '../src/store.mjs';
import { ProductionService } from '../src/production.mjs';
import { HudsonService } from '../src/service.mjs';
import { createApi } from '../src/api.mjs';

async function setup(t) {
  const f=await fixture(t),production=new ProductionService(f);t.after(()=>production.close());
  const file=path.join(f.dir,'sample.gcode.3mf');await writeArchive(file);f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'Piezas de prueba');
  const input={libraryId:item.id,plate:1,piecesPerPlate:4,repetitions:2,settings:{useAms:true,amsMapping:[0]}};
  const jobs=production.add(f.printer.id,input,'queue-add-001').jobs;
  return {...f,production,file,item,input,jobs};
}
const dispatchInput=job=>({jobId:job.id,bedCleared:true,setupConfirmed:true});
async function dispatch(f,job=f.jobs[0],key='dispatch-001') {return f.production.dispatch(f.printer.id,dispatchInput(job),key);}
function report(f,a,status,patch={}) {
  const op=f.store.request(f.printer.id,a.startKey);
  const s=fresh({status,currentJob:{name:op?.packet.print.subtask_name||'',file:op?.packet.print.file||''},...patch});
  f.transport.states.set(f.printer.id,s);f.transport.emit('telemetry',f.printer.id,s);return s;
}
const collectInput={good:4,rejected:0,bedCleared:true,outcome:'finished'};

test('library keeps an immutable copy, deduplicates identical bytes and repairs a damaged copy on reimport',async t=>{
  const f=await setup(t);
  const duplicate=await f.production.importFile(f.file,'Otro nombre');assert.equal(duplicate.id,f.item.id);
  assert.equal(f.store.library().length,1);assert.equal(duplicate.plates[0].filaments[0].grams,30);
  const original=await readFile(f.file);await writeFile(f.file,'source changed');
  assert.deepEqual(await readFile(f.production.file(f.item.id)),original);
  await writeFile(f.production.file(f.item.id),'damaged');await writeFile(f.file,original);
  await f.production.importFile(f.file);assert.deepEqual(await readFile(f.production.file(f.item.id)),original);
  assert.equal((await readdir(path.dirname(f.production.file(f.item.id)))).length,1);
});

test('queue creation is atomic and idempotent, validates plate quantities/profile and supports exact reordering, editing and cancellation',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id;
  assert.equal(p.add(id,{settings:{amsMapping:[0],useAms:true},repetitions:2,piecesPerPlate:4,plate:1,libraryId:f.item.id},'queue-add-001').jobs[0].id,f.jobs[0].id);
  assert.throws(()=>p.add(id,{...f.input,repetitions:3},'queue-add-001'),{code:'KEY_REUSED'});
  assert.throws(()=>p.add(id,{...f.input,piecesPerPlate:0},'invalid-qty'),{code:'QUANTITY'});
  assert.throws(()=>p.add(id,{...f.input,plate:9},'invalid-plate'),{code:'PLATE'});
  assert.throws(()=>p.add(id,{...f.input,settings:{bedCleared:true}},'invalid-setting'),{code:'SETTINGS'});
  assert.throws(()=>p.reorder(id,{jobIds:[f.jobs[0].id]},'reorder-001'),{code:'QUEUE_CHANGED'});
  p.reorder(id,{jobIds:f.jobs.map(j=>j.id).reverse()},'reorder-002');
  assert.equal(p.queue(id).pending[0].id,f.jobs[1].id);
  p.edit(id,f.jobs[0].id,{label:'Pedido corregido'},'edit-label-001');assert.equal(p.job(f.jobs[0].id,id).label,'Pedido corregido');
  p.cancel(id,f.jobs[1].id,{},'cancel-job-001');assert.equal(p.queue(id).counts.plannedPieces,4);
  const other=await f.service.register({serial:'OTHERDEVICE',name:'A1',model:'A1',ipAddress:'192.168.1.11',accessCode:'testcode',nozzleDiameters:[0.4]});
  assert.throws(()=>p.add(other.id,f.input,'model-invalid'),{code:'WRONG_MODEL'});
  assert.equal(p.queue(other.id).pending.length,0);
});

test('one plate starts once, FINISH holds the bed, collection counts once, and the next plate requires a new explicit dispatch',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id;
  await assert.rejects(dispatch(f,f.jobs[1]),{code:'QUEUE_ORDER'});
  await assert.rejects(p.dispatch(id,{jobId:f.jobs[0].id,bedCleared:false,setupConfirmed:true},'dispatch-bad'),{code:'SETUP_REQUIRED'});
  const started=await dispatch(f),a=started.attempt;
  assert.equal(f.transport.calls.length,1);
  assert.equal((await dispatch(f)).attempt.id,a.id);assert.equal(f.transport.calls.length,1);
  assert.throws(()=>p.cancel(id,f.jobs[0].id,{},'cancel-active'),{code:'WRONG_STATE'});
  report(f,a,'printing',{progress:50});report(f,a,'finished',{progress:100});
  assert.equal(p.queue(id).active.attempt.state,'awaiting_collection');
  assert.equal(p.queue(id).counts.good,0);assert.equal(f.transport.calls.length,1);
  await assert.rejects(dispatch(f,f.jobs[1],'dispatch-002'),{code:'COLLECTION_REQUIRED'});
  await assert.rejects(f.service.command(id,'start',startInput,'manual-start-001'),{code:'COLLECTION_REQUIRED'});
  assert.throws(()=>p.collect(id,a.id,{...collectInput,bedCleared:false},'collect-bad'),{code:'BED_REQUIRED'});
  p.collect(id,a.id,collectInput,'collect-001');p.collect(id,a.id,collectInput,'collect-001');
  assert.throws(()=>p.collect(id,a.id,collectInput,'collect-002'),{code:'ALREADY_COLLECTED'});
  assert.equal(p.queue(id).counts.good,4);assert.equal(p.queue(id).active,null);
  assert.equal(f.transport.calls.length,1);await dispatch(f,f.jobs[1],'dispatch-003');assert.equal(f.transport.calls.length,2);
});

test('failure captures progress before stopping; partial good pieces survive a full-plate retry without duplicate counts',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id,a=(await dispatch(f)).attempt;
  report(f,a,'printing',{progress:50,layer:30,totalLayers:60});
  await p.fail(id,a.id,{reason:'Se despegaron tres piezas'},'failed-001');
  await p.fail(id,a.id,{reason:'Se despegaron tres piezas'},'failed-001');
  assert.equal(f.transport.calls.length,2);assert.equal(f.transport.calls[1].packet.print.command,'stop');
  assert.equal(f.store.attempt(a.id).failureTelemetry.progress,50);
  assert.throws(()=>p.collect(id,a.id,{...collectInput,good:1,rejected:3,outcome:'failed'},'collect-failed'),{code:'WRONG_STATE'});
  report(f,a,'idle',{currentJob:{name:'',file:''},progress:0});
  // Firmware can clear its job name after a stop; explicit physical review is then required.
  p.collect(id,a.id,{good:1,rejected:3,outcome:'failed',bedCleared:true,printerChecked:true,note:'Maquina detenida y placa retirada.'},'collect-failed');
  assert.equal(f.store.attempt(a.id).failureTelemetry.progress,50);
  assert.throws(()=>p.retry(id,f.jobs[0].id,{},'retry-001'),{code:'WHOLE_PLATE'});
  const retry=p.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-001');
  assert.equal(retry.remainingTargetAtCreation,3);assert.equal(retry.possibleSurplus,1);
  assert.equal(p.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-001').id,retry.id);
  assert.throws(()=>p.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-002'),{code:'RETRY_EXISTS'});
  p.reorder(id,{jobIds:[retry.id,f.jobs[1].id]},'retry-reorder');
  const again=(await dispatch(f,retry,'retry-dispatch')).attempt;report(f,again,'finished',{progress:100});
  p.collect(id,again.id,collectInput,'collect-retry');
  const counts=p.queue(id).counts;assert.equal(counts.plannedPieces,8);assert.equal(counts.good,5);assert.equal(counts.rejected,3);assert.equal(counts.remainingTargetPieces,4);
  assert.throws(()=>p.retry(id,retry.id,{wholePlateConfirmed:true},'retry-target'),{code:'TARGET_MET'});
});

test('offline, old and foreign telemetry cannot complete or release a plate',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id,a=(await dispatch(f)).attempt;
  report(f,a,'finished',{stateSeenAt:'2000-01-01T00:00:00.000Z'});assert.notEqual(f.store.attempt(a.id).state,'awaiting_collection');
  report(f,a,'finished',{fresh:false});assert.notEqual(f.store.attempt(a.id).state,'awaiting_collection');
  report(f,a,'printing',{currentJob:{name:'external-job',file:'external.3mf'}});
  assert.equal(f.store.attempt(a.id).state,'review');assert.equal(p.queue(id).counts.good,0);
  await assert.rejects(p.fail(id,a.id,{reason:'Falla'},'fail-foreign'),{code:'JOB_MISMATCH'});
  assert.equal(f.transport.calls.length,1);
  report(f,a,'finished',{currentJob:{name:'external-job',file:'external.3mf'}});
  assert.throws(()=>p.collect(id,a.id,collectInput,'foreign-collect'),{code:'REVIEW_REQUIRED'});
});

test('restart reconciles persisted unique print identity, never retransmits, and retains collection state across another restart',async t=>{
  const f=await setup(t),id=f.printer.id,a=(await dispatch(f)).attempt;
  f.production.close();await f.service.close();
  const reopened=new Store(f.dir),transport=new FakeTransport();
  const service=new HudsonService({store:reopened,transport,vault:fakeVault,config:f.config});
  let p=new ProductionService({service,store:reopened,config:f.config});
  try {
    await service.initialize();assert.equal(transport.calls.length,0);assert.equal(reopened.active(id).state,'review');
    assert.equal(reopened.request(id,a.startKey).status,'uncertain');
    const g={...f,production:p,service,store:reopened,transport};report(g,a,'finished',{progress:100});
    assert.equal(reopened.active(id).state,'awaiting_collection');
    p.close();p=new ProductionService({service,store:reopened,config:f.config});
    assert.equal(reopened.active(id).state,'awaiting_collection');
    p.collect(id,a.id,collectInput,'restart-collect');assert.equal(p.queue(id).counts.good,4);
    assert.equal(transport.calls.length,0);
  } finally {p.close();await service.close();reopened.close();}
});

test('crash after reserving a plate but before sending requires review and can close as no production',async t=>{
  const f=await setup(t),id=f.printer.id;
  const a={id:'interrupted-attempt',printerId:id,jobId:f.jobs[0].id,startKey:'interrupted-start',state:'uploading',createdAt:new Date().toISOString()};
  f.store.saveAttempt(a);f.store.claim(id,a.id);f.store.saveJob({...f.jobs[0],state:'dispatching',attemptId:a.id});
  f.production.close();const p=new ProductionService(f);t.after(()=>p.close());
  assert.equal(f.store.active(id).state,'review');assert.equal(f.transport.calls.length,0);
  assert.throws(()=>p.collect(id,a.id,{...collectInput,good:0,rejected:0,outcome:'aborted'},'crash-collect'),{code:'REVIEW_REQUIRED'});
  p.collect(id,a.id,{good:0,rejected:0,outcome:'aborted',bedCleared:true,printerChecked:true,note:'No inicio; verificada cama libre.'},'crash-collect');
  assert.equal(p.queue(id).counts.good,0);assert.equal(p.queue(id).counts.unproduced,4);assert.equal(p.queue(id).active,null);
});

test('concurrent dispatch and collection cannot race an upload; ambiguous network send remains held',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id;
  let release,uploaded;const began=new Promise(r=>uploaded=r),hold=new Promise(r=>release=r);
  f.transport.upload=async()=>{uploaded();await hold;return {bytes:f.transport.uploadBytes};};
  const starting=dispatch(f);await began;
  const a=f.store.active(id);assert.ok(a);
  assert.equal((await dispatch(f)).attempt.id,a.id);
  await assert.rejects(dispatch(f,f.jobs[0],'concurrent-start'),{code:'COLLECTION_REQUIRED'});
  assert.throws(()=>p.collect(id,a.id,{good:0,rejected:0,outcome:'aborted',bedCleared:true,printerChecked:true,note:'No inicio.'},'concurrent-collect'),{code:'BUSY'});
  await assert.rejects(f.service.register({serial:f.printer.serial,ipAddress:f.printer.ipAddress,model:'P1S',nozzleDiameters:[0.4]}),{code:'BUSY'});
  f.transport.failPublish=true;release();await starting;
  assert.equal(f.transport.calls.length,1);assert.equal(p.queue(id).active.startOperation.status,'uncertain');
  await dispatch(f);assert.equal(f.transport.calls.length,1);
});

test('failed upload or library integrity error never sends a start and retrying the same request does not trigger another upload',async t=>{
  const f=await setup(t),id=f.printer.id;let uploads=0;
  f.transport.upload=async()=>{uploads++;throw new Error('FTPS down');};
  const first=await dispatch(f);assert.equal(first.attempt.state,'not_sent');assert.equal(f.store.active(id),undefined);
  assert.equal(f.store.job(f.jobs[0].id).state,'queued');await dispatch(f);assert.equal(uploads,1);assert.equal(f.transport.calls.length,0);
  await writeFile(f.production.file(f.item.id),'tampered');
  const second=await dispatch(f,f.jobs[0],'integrity-dispatch');assert.equal(second.attempt.detail,'LIBRARY_CORRUPTED');
  assert.equal(uploads,1);assert.equal(f.transport.calls.length,0);
  await f.production.importFile(f.file);
  f.transport.upload=async()=>({bytes:f.transport.uploadBytes});await dispatch(f,f.jobs[0],'fixed-dispatch');assert.equal(f.transport.calls.length,1);
});

test('invalid counts roll back without releasing the bed and an early failure records unproduced pieces',async t=>{
  const f=await setup(t),id=f.printer.id,p=f.production,a=(await dispatch(f)).attempt;
  report(f,a,'failed',{progress:2});
  assert.throws(()=>p.collect(id,a.id,collectInput,'hide-failure'),{code:'OUTCOME'});
  assert.throws(()=>p.collect(id,a.id,{good:3,rejected:2,bedCleared:true,outcome:'failed'},'counts-001'),{code:'COUNTS'});
  assert.equal(f.store.collection(a.id),undefined);assert.ok(f.store.active(id));
  const r=p.collect(id,a.id,{good:0,rejected:1,bedCleared:true,outcome:'failed'},'counts-001');
  assert.equal(r.collection.unproduced,3);assert.equal(p.queue(id).counts.remainingTargetPieces,8);
});

test('phase 2 HTTP library and production flow use authenticated idempotent routes',async t=>{
  const f=await setup(t),token='production-test-token',server=createApi({...f,token});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,root=`/api/printers/${f.printer.id}/queue`;
  const call=(route,body,key)=>fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await fetch(base+'/api/library')).status,401);
  assert.equal((await(await fetch(base+'/health')).json()).instanceId,'harv-hudson');
  const upload=await fetch(base+'/api/library?name=Test',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:await readFile(f.file)});
  assert.equal(upload.status,201);assert.equal((await upload.json()).file.id,f.item.id);
  assert.equal((await(await call('/api/library')).json()).files.length,1);
  assert.equal((await call(root,f.input)).status,400);
  const first=await call(root+'/dispatch',dispatchInput(f.jobs[0]),'http-dispatch');assert.equal(first.status,202);
  const a=(await first.json()).attempt;report(f,a,'finished');
  const route=`/api/printers/${f.printer.id}/attempts/${a.id}/collect`;
  assert.equal((await call(route,collectInput,'http-collect')).status,200);
  assert.equal((await call(route,collectInput,'http-collect')).status,200);
  assert.equal((await(await call(root)).json()).counts.good,4);assert.equal(f.transport.calls.length,1);
  assert.deepEqual(await readdir(path.join(f.dir,'incoming')),[]);
});

test('cancelling a queued retry permits a replacement without adding production to the original target',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id,a=(await dispatch(f)).attempt;
  report(f,a,'failed');p.collect(id,a.id,{good:0,rejected:4,bedCleared:true,outcome:'failed'},'retry-collect');
  const one=p.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-first');
  p.cancel(id,one.id,{},'retry-cancel');
  const two=p.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-replace');
  assert.notEqual(one.id,two.id);assert.equal(p.queue(id).pending.length,2);assert.equal(p.queue(id).counts.plannedPieces,8);
});

test('a rejected start cannot manufacture success; explicit review and terminal machine state are required',async t=>{
  const f=await setup(t),id=f.printer.id,p=f.production,a=(await dispatch(f)).attempt;
  const op=f.store.request(id,a.startKey);f.transport.emit('ack',id,{command:'project_file',sequence_id:op.sequence,result:'fail',reason:'File rejected'});
  report(f,a,'idle',{currentJob:{name:'',file:''}});
  assert.equal(f.store.active(id).state,'review');
  assert.throws(()=>p.collect(id,a.id,{good:0,rejected:0,bedCleared:true,outcome:'aborted'},'reject-collect'),{code:'REVIEW_REQUIRED'});
  const c=p.collect(id,a.id,{good:0,rejected:0,bedCleared:true,outcome:'aborted',printerChecked:true,note:'No inicio. Cama libre.'},'reject-collect');
  assert.equal(c.collection.good,0);assert.equal(f.transport.calls.length,1);assert.equal(p.queue(id).active,null);
});
