import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fixture,fresh,writeArchive } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { InventoryService } from '../src/inventory.mjs';
import { createApi } from '../src/api.mjs';
import { operatorState } from '../public/ipad-state.js';
import { createIpad } from '../public/ipad.js';

async function setup(t) {
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const filename=path.join(f.dir,'operator-fixture.3mf');await writeArchive(filename);
  f.transport.uploadBytes=(await stat(filename)).size;
  const item=await production.importFile(filename,'Placa del operador');
  const spool=inventory.create({name:'Prueba',material:'PLA',remainingGrams:1000,basis:'measured'},'ipad-spool');
  inventory.bind(f.printer.id,{spoolId:spool.id,source:'ams',amsId:0,slotId:0,confirmed:true},'ipad-mount');
  const jobs=production.add(f.printer.id,{libraryId:item.id,plate:1,piecesPerPlate:4,repetitions:2,settings:{useAms:true,amsMapping:[0]}},'ipad-queue').jobs;
  const result=await production.dispatch(f.printer.id,{jobId:jobs[0].id,bedCleared:true,setupConfirmed:true},'ipad-start');
  const report=(status,patch={})=>{
    const packet=f.store.request(f.printer.id,result.attempt.startKey).packet.print;
    const s=fresh({status,currentJob:{name:packet.subtask_name,file:packet.file},...patch});
    f.transport.states.set(f.printer.id,s);f.transport.emit('telemetry',f.printer.id,s);return s;
  };
  const view=()=>operatorState({...f.printer,telemetry:f.transport.status(f.printer.id)},production.queue(f.printer.id));
  return {...f,production,inventory,spool,jobs,a:result.attempt,report,view};
}
const body=(outcome='finished',retry=false)=>({outcome,retry,bedCleared:true,printerChecked:true});
const recoverBody={neverStarted:true,noFilamentUsed:true,bedCleared:true};
function rejectedStart(f,status='rejected') {
  const op=f.store.request(f.printer.id,f.a.startKey);
  f.store.saveOperation({...op,status,detail:'mqtt message verify failed'});
  f.store.saveAttempt({...f.store.attempt(f.a.id),state:'review'});
  f.store.saveJob({...f.jobs[0],state:'review',attemptId:f.a.id});
  f.transport.states.set(f.printer.id,fresh({status:'finished',progress:100,currentJob:{name:'Impresión anterior',file:'old.3mf'}}));
}

test('an unstarted review never borrows the previous print percentage; recovery is explicit, atomic and does not print or consume filament',async t=>{
  for(const status of ['rejected','resolved']) {
    const f=await setup(t),p=f.production,id=f.printer.id;rejectedStart(f,status);
    const before=f.inventory.view(f.spool.id),view=f.view();
    assert.equal(view.progress,null);assert.equal(view.canRecover,true);assert.equal(view.canStart,false);assert.equal(view.canPrint,false);
    assert.equal(view.label,status==='rejected'?'No comenzó':'Inicio sin confirmar');
    for(const field of Object.keys(recoverBody))assert.throws(()=>p.recoverStart(id,f.a.id,{...recoverBody,[field]:false},`missing-${field}`),{code:'REVIEW_REQUIRED'});
    const calls=f.transport.calls.length;
    const result=p.recoverStart(id,f.a.id,recoverBody,'recover-ipad');
    assert.deepEqual(p.recoverStart(id,f.a.id,recoverBody,'recover-ipad'),result);
    assert.equal(f.store.active(id),undefined);assert.equal(p.queue(id).pending[0].id,f.jobs[0].id);
    assert.equal(f.store.jobs(id).length,2);assert.equal(f.store.attempt(f.a.id).state,'recovered');
    assert.equal(f.store.usage(f.a.id).totalGrams,0);assert.equal(f.store.usage(f.a.id).method,'no-start');
    assert.equal(f.inventory.view(f.spool.id).remainingGrams,before.remainingGrams);
    assert.equal(f.inventory.view(f.spool.id).reservedGrams,before.reservedGrams);
    assert.equal(f.transport.calls.length,calls);assert.equal(p.queue(id).counts.good,0);assert.equal(f.view().canStart,true);
    assert.throws(()=>p.recoverStart(id,f.a.id,recoverBody,'recover-other-key'),{code:'NOT_ACTIVE'});
    const next=await p.dispatch(id,{jobId:f.jobs[0].id,bedCleared:true,setupConfirmed:true},'explicit-new-start');
    assert.notEqual(next.attempt.id,f.a.id);assert.equal(f.transport.calls.length,calls+1);
    assert.deepEqual(p.recoverStart(id,f.a.id,recoverBody,'recover-ipad'),result);
    assert.equal(f.store.active(id).id,next.attempt.id);
  }
});

test('recovery refuses stale, running, matched, observed, unresolved or already accounted attempts',async t=>{
  const cases=[
    f=>f.transport.states.set(f.printer.id,fresh({fresh:false})),
    f=>f.transport.states.set(f.printer.id,fresh({status:'printing'})),
    f=>f.transport.states.set(f.printer.id,fresh({currentJob:{name:f.store.request(f.printer.id,f.a.startKey).packet.print.subtask_name,file:''}})),
    f=>f.store.saveAttempt({...f.store.attempt(f.a.id),observedStartedAt:new Date().toISOString()}),
    f=>f.store.saveAttempt({...f.store.attempt(f.a.id),materialProgress:{percent:0}}),
    f=>f.store.saveAttempt({...f.store.attempt(f.a.id),failureRequested:true}),
    f=>f.store.saveOperation({...f.store.request(f.printer.id,f.a.startKey),status:'uncertain'}),
    f=>f.store.saveUsage({attemptId:f.a.id,status:'needs_review'})
  ];
  for(const change of cases){const f=await setup(t);rejectedStart(f);change(f);
    assert.equal(f.view().canRecover,false);
    assert.throws(()=>f.production.recoverStart(f.printer.id,f.a.id,recoverBody,'unsafe-recovery'),{code:'OPERATOR_REVIEW'});
    assert.equal(f.store.active(f.printer.id).id,f.a.id);assert.equal(f.transport.calls.length,1);
  }
});

test('failed recovery transaction leaves the original attempt and stock intact',async t=>{
  const f=await setup(t);rejectedStart(f);const replan=f.inventory.replan;
  f.inventory.replan=()=>{throw new Error('recovery transaction failed');};
  assert.throws(()=>f.production.recoverStart(f.printer.id,f.a.id,recoverBody,'recovery-rollback'),/transaction failed/);
  f.inventory.replan=replan;
  assert.equal(f.store.active(f.printer.id).id,f.a.id);assert.equal(f.store.usage(f.a.id),undefined);
  assert.equal(f.store.job(f.jobs[0].id).state,'review');assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);
  f.production.recoverStart(f.printer.id,f.a.id,recoverBody,'recovery-rollback');
  assert.equal(f.view().canStart,true);
});

test('material mismatch gives a useful iPad hint without enabling Start',()=>{
  const view=operatorState({telemetry:fresh()},{active:null,pending:[{materialPlan:{state:'blocked',issues:[{code:'COLOR_MISMATCH',material:'PLA',color:'#FFFFFF'}]}}]});
  assert.match(view.hint,/PLA blanco/);assert.equal(view.canStart,false);
});

test('recover-start HTTP route requires authorization, origin, confirmations and exact replay',async t=>{
  const f=await setup(t);rejectedStart(f);
  const server=createApi({...f,token:'recovery-test-token'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,url=base+`/api/printers/${f.printer.id}/attempts/${f.a.id}/recover-start`;
  const opts={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'recovery-http'},body:JSON.stringify(recoverBody)};
  assert.equal((await fetch(url,opts)).status,401);
  const login=await fetch(base+'/api/ui/local-session',{method:'POST',headers:{Origin:base,'X-Hudson-UI':'1','Content-Type':'application/json'},body:'{}'});
  opts.headers.Cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url,opts)).status,403);
  opts.headers.Origin=base;opts.headers['X-Hudson-UI']='1';
  const first=await fetch(url,opts);assert.equal(first.status,200);
  assert.deepEqual(await (await fetch(url,opts)).json(),await first.json());
  assert.equal(f.transport.calls.length,1);
});

test('external prints show actual state, progress and filename without becoming Hudson attempts',()=>{
  const queue={active:null,pending:[]};
  for(const [status,label] of [['printing','Imprimiendo…'],['preparing','Preparando…'],['paused','En pausa'],['finished','Terminó'],['failed','Impresión fallida']]) {
    const view=operatorState({telemetry:fresh({status,progress:status==='finished'?100:42,currentJob:{name:'Desde Bambu Studio',file:''}})},queue);
    assert.equal(view.label,label);assert.equal(view.progress,status==='finished'?100:42);
    assert.equal(view.currentJobName,'Desde Bambu Studio');
    assert.equal(view.canFail,false);assert.equal(view.canPrint,false);assert.equal(view.canStart,false);
  }
  const unnamed=operatorState({telemetry:fresh({status:'printing',progress:8,currentJob:{name:'',file:'Metadata/placa_2.gcode'}})},queue);
  assert.equal(unnamed.currentJobName,'placa_2.gcode');
});

test('idle printers show Disponible and do not display the previous print as active',()=>{
  const view=operatorState({telemetry:fresh({status:'idle',progress:100,currentJob:{name:'Trabajo anterior'}})},{active:null,pending:[]});
  assert.equal(view.label,'Disponible');assert.equal(view.progress,null);assert.equal(view.currentJobName,'');
  const unknown=operatorState({telemetry:fresh({status:'unknown',progress:100})},{active:null,pending:[]});
  assert.equal(unknown.label,'Estado por confirmar');assert.equal(unknown.progress,null);
});

test('stale or disconnected external telemetry is never presented as a live print',()=>{
  for(const [freshness,connected] of [[false,true],[true,false]]) {
    const view=operatorState({telemetry:fresh({status:'printing',fresh:freshness,progress:75,currentJob:{name:'Viejo'}})},{active:null,pending:[]},connected);
    assert.equal(view.label,'Sin conexión');assert.equal(view.progress,null);assert.equal(view.currentJobName,'');
    assert.equal(view.canFail,false);assert.equal(view.canPrint,false);
  }
});

test('Printed remains disabled while printing; finished collection counts once and never starts the next plate',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id;
  f.report('printing',{progress:50});assert.equal(f.view().canPrint,false);
  assert.throws(()=>p.operatorCollect(id,f.a.id,body(),'ipad-collect'),{code:'OPERATOR_REVIEW'});
  f.report('finished',{progress:100});assert.equal(f.view().canPrint,true);
  assert.throws(()=>p.operatorCollect(id,f.a.id,{...body(),bedCleared:false},'ipad-empty-bed'),{code:'BED_REQUIRED'});
  assert.throws(()=>p.operatorCollect(id,f.a.id,body('failed',true),'ipad-wrong-outcome'),{code:'OUTCOME_CHANGED'});
  p.operatorCollect(id,f.a.id,body(),'ipad-collect');p.operatorCollect(id,f.a.id,body(),'ipad-collect');
  assert.equal(p.queue(id).counts.good,4);assert.equal(p.queue(id).pending.length,1);
  assert.equal(f.transport.calls.length,1);assert.equal(f.inventory.view(f.spool.id).remainingGrams,970);
  assert.equal(f.view().canStart,true);
});

test('the iPad can collect after a positively identified finish clears its filename, including after restart',async t=>{
  const f=await setup(t);f.report('printing',{progress:40});f.report('finished',{progress:100});
  f.report('idle',{progress:0,currentJob:{name:'',file:''}});
  assert.equal(f.view().collection,true);
  f.production.close();
  const restarted=new ProductionService(f);restarted.inventory=f.inventory;t.after(()=>restarted.close());
  assert.equal(restarted.queue(f.printer.id).active.operatorCollection.available,true);
  restarted.operatorCollect(f.printer.id,f.a.id,body(),'collected-after-idle');
  assert.equal(f.store.active(f.printer.id),undefined);assert.equal(f.inventory.view(f.spool.id).remainingGrams,970);
  assert.equal(restarted.queue(f.printer.id).counts.good,4);assert.equal(f.transport.calls.length,1);
});

test('another print after the terminal report prevents iPad collection even if its name subsequently disappears',async t=>{
  const f=await setup(t);f.report('finished',{progress:100});
  f.report('printing',{progress:5,currentJob:{name:'Other job',file:'other.3mf'}});
  f.report('idle',{currentJob:{name:'',file:''}});
  assert.equal(f.view().collection,false);assert.equal(f.store.attempt(f.a.id).collectionConflict,true);
  assert.throws(()=>f.production.operatorCollect(f.printer.id,f.a.id,body(),'foreign-then-idle'),{code:'OPERATOR_REVIEW'});
  assert.equal(f.store.collection(f.a.id),undefined);
});

test('a completed plate with a cleared filename can be marked failed then collected without another stop command',async t=>{
  const f=await setup(t);f.report('finished',{progress:100});f.report('idle',{progress:0,currentJob:{name:'',file:''}});
  await f.production.fail(f.printer.id,f.a.id,{reason:'Las piezas salieron mal'},'finished-failed');
  assert.equal(f.view().collection,true);
  f.production.operatorCollect(f.printer.id,f.a.id,body('failed',true),'failed-after-clear');
  assert.equal(f.production.queue(f.printer.id).counts.rejected,4);assert.equal(f.inventory.view(f.spool.id).remainingGrams,970);
  assert.equal(f.transport.calls.length,1);
});

test('the iPad can skip an unstarted attempt after a physical check and release the next job exactly once',async t=>{
  const f=await setup(t);rejectedStart(f);
  const input={...recoverBody,action:'skip'};
  assert.throws(()=>f.production.recoverStart(f.printer.id,f.a.id,{...input,bedCleared:false},'skip-unchecked'),{code:'REVIEW_REQUIRED'});
  const result=f.production.recoverStart(f.printer.id,f.a.id,input,'skip-confirmed');
  assert.deepEqual(f.production.recoverStart(f.printer.id,f.a.id,input,'skip-confirmed'),result);
  assert.equal(result.skipped,true);assert.equal(result.requeued,false);assert.equal(f.store.job(f.jobs[0].id).state,'cancelled');
  assert.equal(f.production.queue(f.printer.id).pending[0].id,f.jobs[1].id);assert.equal(f.view().canStart,true);
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);assert.equal(f.transport.calls.length,1);
});

test('iPad collection requires an explicit empty-bed check then offers a separately confirmed next Start',async t=>{
  const f=await setup(t);f.report('finished',{progress:100});
  let checked=false,click,requests=0;
  const form={reportValidity:()=>checked,addEventListener:(name,fn)=>{if(name==='click')click=fn;}};
  const error={textContent:''},dialog={open:false,innerHTML:'',classList:{remove(){},add(){}},addEventListener(){},
    showModal(){this.open=true;checked=false;},close(){this.open=false;},querySelector:s=>s==='form'?form:error,querySelectorAll:()=>[]};
  const state={connected:true,data:null};
  const refresh=async()=>{state.data={printers:[{...f.printer,telemetry:f.transport.status(f.printer.id)}],queues:[f.production.queue(f.printer.id)]};};
  await refresh();
  const ipad=createIpad({state,esc:String,dialog,toast(){},openForm(){},repaint(){},refresh,mutate:async(route,input)=>{
    requests++;
    if(route.endsWith('/operator-collect'))return f.production.operatorCollect(f.printer.id,f.a.id,input,'tablet-collected');
    if(route.endsWith('/dispatch'))return f.production.dispatch(f.printer.id,input,'tablet-next-start');
    throw new Error(`Unexpected request ${route}`);
  }});
  const choose=choice=>click({target:{closest:()=>({dataset:{choice}})}});
  ipad.action({dataset:{action:'operator-printed',id:f.printer.id}});
  assert.match(dialog.innerHTML,/Confirmar placa retirada/);assert.match(dialog.innerHTML,/checkbox.*required/);
  await choose('collect');assert.equal(requests,0);
  checked=true;await choose('collect');
  assert.equal(f.production.queue(f.printer.id).counts.good,4);assert.match(dialog.innerHTML,/Placa registrada/);
  assert.match(dialog.innerHTML,/Iniciar siguiente/);assert.equal(f.transport.calls.length,1);
  await choose('start');assert.equal(requests,1);
  checked=true;await choose('start');assert.equal(requests,2);assert.equal(f.transport.calls.length,2);
  assert.equal(f.store.active(f.printer.id).jobId,f.jobs[1].id);
});

test('Failed then retry keeps 15g consumption, creates exactly one retry first and requires a separate Start',async t=>{
  const f=await setup(t),p=f.production,id=f.printer.id;
  f.report('printing',{progress:50});await p.fail(id,f.a.id,{reason:'Se despegó'},'ipad-fail');
  assert.equal(f.view().canPrint,false);assert.equal(f.view().collection,false);
  assert.throws(()=>p.operatorCollect(id,f.a.id,body('failed',true),'ipad-retry'),{code:'OPERATOR_REVIEW'});
  f.report('idle',{progress:0,currentJob:{name:'',file:''}});
  assert.equal(f.view().collection,true);
  const result=p.operatorCollect(id,f.a.id,body('failed',true),'ipad-retry');
  const repeat=p.operatorCollect(id,f.a.id,body('failed',true),'ipad-retry');
  assert.equal(result.job.retryJobId,repeat.job.retryJobId);
  const queue=p.queue(id);assert.equal(queue.pending.length,2);assert.equal(queue.pending[0].id,result.job.retryJobId);
  assert.equal(queue.pending[1].id,f.jobs[1].id);assert.equal(queue.counts.rejected,4);
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,985);assert.equal(f.transport.calls.length,2);
  assert.throws(()=>p.operatorCollect(id,f.a.id,body('failed',false),'ipad-retry'),{code:'KEY_REUSED'});
  assert.throws(()=>p.operatorCollect(id,f.a.id,body('failed',true),'ipad-other-key'),{code:'OPERATOR_REVIEW'});
});

test('failed collection can continue the queue without creating a retry',async t=>{
  const f=await setup(t);f.report('printing',{progress:20});f.report('failed',{progress:20});
  f.production.operatorCollect(f.printer.id,f.a.id,body('failed'),'ipad-skip');
  assert.equal(f.production.queue(f.printer.id).pending.length,1);
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,994);
});

test('missing progress blocks simple collection instead of inventing filament usage',async t=>{
  const f=await setup(t);f.report('failed');assert.equal(f.view().collection,false);
  assert.throws(()=>f.production.operatorCollect(f.printer.id,f.a.id,body('failed',true),'ipad-no-progress'),{code:'USAGE_REVIEW'});
  assert.equal(f.store.collection(f.a.id),undefined);assert.equal(f.store.jobs(f.printer.id).length,2);
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);
});

test('offline, changed job and unresolved stop block novice actions',async t=>{
  const f=await setup(t);f.report('printing',{progress:50});await f.production.fail(f.printer.id,f.a.id,{reason:'Fallo'},'ipad-failed');
  const waiting=f.view();assert.equal(waiting.canFail,false);assert.equal(waiting.canStart,false);
  f.report('failed',{progress:50});
  f.transport.states.set(f.printer.id,fresh({status:'failed',currentJob:{name:'another-job',file:'another-file'}}));
  assert.equal(f.view().collection,false);
  assert.throws(()=>f.production.operatorCollect(f.printer.id,f.a.id,body('failed',true),'ipad-foreign'),{code:'OPERATOR_REVIEW'});
  f.report('failed',{progress:50,fresh:false});assert.equal(f.view().canFail,false);assert.equal(f.view().canPrint,false);
});

test('collection and retry roll back together if inventory planning fails',async t=>{
  const f=await setup(t);f.report('failed',{progress:50});
  const replan=f.inventory.replan;f.inventory.replan=()=>{throw new Error('Synthetic storage failure');};
  assert.throws(()=>f.production.operatorCollect(f.printer.id,f.a.id,body('failed',true),'ipad-rollback'),/Synthetic/);
  f.inventory.replan=replan;
  assert.equal(f.store.collection(f.a.id),undefined);assert.equal(f.store.jobs(f.printer.id).length,2);assert.ok(f.store.active(f.printer.id));
  f.production.operatorCollect(f.printer.id,f.a.id,body('failed',true),'ipad-rollback');
  assert.equal(f.store.jobs(f.printer.id).length,3);
});

test('iPad assets are served and operator endpoint requires authentication and supports exact replay',async t=>{
  const f=await setup(t),server=createApi({...f,token:'ipad-test-token'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const asset of ['/ipad','/ipad.js','/ipad-state.js','/ipad.css'])assert.equal((await fetch(base+asset)).status,200);
  f.report('finished',{progress:100});
  const url=base+`/api/printers/${f.printer.id}/attempts/${f.a.id}/operator-collect`;
  const opts={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'ipad-http'},body:JSON.stringify(body())};
  assert.equal((await fetch(url,opts)).status,401);
  const login=await fetch(base+'/api/ui/local-session',{method:'POST',headers:{Origin:base,'X-Hudson-UI':'1','Content-Type':'application/json'},body:'{}'});
  const cookie=login.headers.get('set-cookie').split(';')[0];opts.headers.Cookie=cookie;
  assert.equal((await fetch(url,opts)).status,403);
  opts.headers.Origin=base;opts.headers['X-Hudson-UI']='1';
  assert.equal((await fetch(url,opts)).status,200);assert.equal((await fetch(url,opts)).status,200);
  assert.equal(f.production.queue(f.printer.id).counts.good,4);
});
