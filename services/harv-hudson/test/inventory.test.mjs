import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat,writeFile } from 'node:fs/promises';
import { fixture,fresh,writeArchive,FakeTransport,fakeVault,startInput } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { InventoryService } from '../src/inventory.mjs';
import { HudsonService } from '../src/service.mjs';
import { Store } from '../src/store.mjs';
import { createApi } from '../src/api.mjs';

async function setup(t,{remaining=1000,repetitions=2}={}) {
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const file=path.join(f.dir,'plate.gcode.3mf');await writeArchive(file);f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'30 g por placa');
  const spool=inventory.create({name:'PLA white',material:'PLA',color:'#FFFFFF',remainingGrams:remaining,basis:'measured'},'spool-add-001');
  inventory.bind(f.printer.id,{spoolId:spool.id,source:'ams',amsId:0,slotId:0,confirmed:true},'spool-mount-001');
  const input={libraryId:item.id,plate:1,piecesPerPlate:4,repetitions,settings:{useAms:true,amsMapping:[0]}};
  const jobs=production.add(f.printer.id,input,'add-jobs-001').jobs;
  return {...f,production,inventory,file,item,spool,input,jobs};
}
async function start(f,job=f.jobs[0],key='start-job-001') {return f.production.dispatch(f.printer.id,{jobId:job.id,bedCleared:true,setupConfirmed:true},key);}
function report(f,a,status,patch={}) {
  const op=f.store.request(f.printer.id,a.startKey),s=fresh({status,currentJob:{name:op?.packet.print.subtask_name||'',file:op?.packet.print.file||''},...patch});
  f.transport.states.set(f.printer.id,s);f.transport.emit('telemetry',f.printer.id,s);return s;
}
const collected={good:4,rejected:0,outcome:'finished',bedCleared:true};

test('filament mismatch alert identifies the file, mounted roll and slot and clears after a matching assignment',async t=>{
  const f=await setup(t),id=f.printer.id;
  const black=f.inventory.create({name:'Negro de prueba',material:'PLA',color:'#000000',remainingGrams:1000,basis:'measured'},'alert-black-roll');
  f.inventory.bind(id,{spoolId:black.id,source:'ams',amsId:0,slotId:0,confirmed:true},'alert-black-mount');
  const plan=f.production.queue(id).pending[0].materialPlan,issue=plan.issues.find(i=>i.code==='COLOR_MISMATCH');
  assert.equal(plan.state,'blocked');assert.deepEqual(issue.expected,{material:'PLA',color:'#FFFFFF'});
  assert.equal(issue.loaded.name,'Negro de prueba');assert.equal(issue.loaded.color,'#000000');assert.equal(issue.source.slotId,0);
  await assert.rejects(start(f),{code:'MATERIAL_BLOCKED'});assert.equal(f.transport.calls.length,0);
  assert.equal(f.store.active(id),undefined);assert.equal(f.inventory.view(black.id).remainingGrams,1000);
  f.inventory.bind(id,{spoolId:f.spool.id,source:'ams',amsId:0,slotId:0,confirmed:true},'alert-correct-mount');
  assert.equal(f.production.queue(id).pending[0].materialPlan.state,'ready');
  assert.equal(f.production.queue(id).pending[0].materialPlan.issues.length,0);
});

test('current slot reports expose wrong material and removed filament without changing queue or inventory',async t=>{
  const f=await setup(t),id=f.printer.id,stock=f.inventory.view(f.spool.id);
  f.transport.states.set(id,fresh({slots:[{source:'ams',amsId:0,slotId:0,material:'PETG',color:'FFFFFFFF',empty:false}]}));
  let plan=f.production.queue(id).pending[0].materialPlan;
  assert.equal(plan.state,'blocked');assert.equal(plan.issues[0].code,'PRINTER_MATERIAL_MISMATCH');
  assert.equal(plan.issues[0].reported.material,'PETG');
  await assert.rejects(start(f),{code:'MATERIAL_MISMATCH'});
  f.transport.states.set(id,fresh({slots:[]}));plan=f.production.queue(id).pending[0].materialPlan;
  assert.equal(plan.state,'blocked');assert.equal(plan.issues[0].code,'SOURCE_NOT_LOADED');
  await assert.rejects(start(f),{code:'AMS_SLOT'});
  f.transport.states.set(id,fresh());assert.equal(f.production.queue(id).pending[0].materialPlan.state,'ready');
  assert.equal(f.transport.calls.length,0);assert.equal(f.store.jobs(id).length,2);
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,stock.remainingGrams);
  assert.equal(f.inventory.view(f.spool.id).reservedGrams,stock.reservedGrams);
});

test('a configured color disagreement is labeled separately from the confirmed physical roll and stale reports are ignored',async t=>{
  const f=await setup(t),id=f.printer.id;
  f.transport.states.set(id,fresh({slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',color:'000000FF',empty:false}]}));
  let plan=f.production.queue(id).pending[0].materialPlan;
  assert.equal(plan.state,'ready');assert.equal(plan.issues.length,0);assert.equal(plan.warnings[0].code,'PRINTER_COLOR_CONFLICT');
  assert.equal(plan.warnings[0].loaded.color,'#FFFFFF');assert.equal(plan.warnings[0].reported.color,'000000FF');
  assert.equal(f.inventory.view(f.spool.id).color,'#FFFFFF');
  for(const patch of [{fresh:false},{slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',color:'00000000',empty:false}]},{slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',color:'FFFFFFFF',empty:false}]}]){
    f.transport.states.set(id,fresh(patch));plan=f.production.queue(id).pending[0].materialPlan;assert.equal(plan.warnings.length,0);
  }
});

test('an unassigned spool alert retains the required filament and location',async t=>{
  const f=await setup(t),id=f.printer.id;
  f.inventory.bind(id,{spoolId:null,source:'ams',amsId:0,slotId:0,confirmed:true},'alert-unmount');
  const issue=f.production.queue(id).pending[0].materialPlan.issues[0];
  assert.equal(issue.code,'SPOOL_REQUIRED');assert.equal(issue.loaded,null);assert.equal(issue.expected.material,'PLA');assert.equal(issue.source.source,'ams');
});

test('manual inventory accepts net or gross-minus-tare, idempotent adjustments, editable alerts and archival without deleting history',async t=>{
  const f=await setup(t),i=f.inventory;
  const input={name:'PETG red',material:'PETG',grossGrams:850,tareGrams:200,basis:'measured',lowGrams:80};
  const s=i.create(input,'create-weighed');assert.equal(s.remainingGrams,650);assert.equal(s.balanceIsEstimate,false);
  assert.equal(i.create(input,'create-weighed').id,s.id);assert.equal(f.store.ledger(s.id).length,1);
  assert.throws(()=>i.create({...input,tareGrams:900},'invalid-tare'),{code:'WEIGHT'});
  assert.throws(()=>i.create({...input,remainingGrams:40},'mixed-weights'),{code:'WEIGHT'});
  const changed=i.adjust(s.id,{remainingGrams:60,basis:'estimated',reason:'Estimacion de rollo parcial.'},'adjust-stock');
  assert.equal(changed.remainingGrams,60);assert.equal(changed.balanceIsEstimate,true);assert.ok(changed.alerts.includes('LOW_STOCK'));
  i.adjust(s.id,{remainingGrams:60,basis:'estimated',reason:'Estimacion de rollo parcial.'},'adjust-stock');assert.equal(f.store.ledger(s.id).length,2);
  const archived=i.edit(s.id,{archived:true,name:'PETG agotado'},'archive-stock');assert.equal(archived.archived,true);assert.equal(f.store.ledger(s.id).length,2);
});

test('queue reserves with a margin without deducting stock; shortages block only uncovered plates and cancellation releases reservation',async t=>{
  const f=await setup(t,{remaining:50}),i=f.inventory,id=f.printer.id;
  const s=i.view(f.spool.id);assert.equal(s.remainingGrams,50);assert.equal(s.reservedGrams,70);assert.equal(s.availableGrams,-20);assert.ok(s.alerts.includes('QUEUE_SHORTAGE'));
  assert.equal(f.store.materialPlan(f.jobs[0].id).state,'ready');assert.equal(f.store.materialPlan(f.jobs[1].id).state,'blocked');
  const a=(await start(f)).attempt;report(f,a,'finished',{progress:100});
  assert.equal(i.view(f.spool.id).remainingGrams,20);assert.equal(i.view(f.spool.id).reservedGrams,35);
  f.production.collect(id,a.id,collected,'collect-stock');
  await assert.rejects(start(f,f.jobs[1],'start-shortage'),{code:'MATERIAL_BLOCKED'});assert.equal(f.transport.calls.length,1);
  f.production.cancel(id,f.jobs[1].id,{},'cancel-shortage');assert.equal(i.view(f.spool.id).reservedGrams,0);
});

test('a 30 g plate failing at 50% deducts 15 g exactly once before collection, retains progress through reset and reserves a new retry',async t=>{
  const f=await setup(t),id=f.printer.id,i=f.inventory,a=(await start(f)).attempt;
  report(f,a,'printing',{progress:50,layer:20,totalLayers:40});
  await f.production.fail(id,a.id,{reason:'Se despego la pieza'},'failed-50pct');
  assert.equal(i.view(f.spool.id).remainingGrams,1000);
  report(f,a,'failed',{progress:0});
  const usage=f.store.usage(a.id);assert.equal(usage.totalGrams,15);assert.equal(usage.method,'progress-estimate');assert.equal(i.view(f.spool.id).remainingGrams,985);
  report(f,a,'failed',{progress:0});assert.equal(i.view(f.spool.id).remainingGrams,985);
  const body={good:1,rejected:3,outcome:'failed',bedCleared:true};
  f.production.collect(id,a.id,body,'collect-fail-50');f.production.collect(id,a.id,body,'collect-fail-50');
  assert.equal(i.view(f.spool.id).remainingGrams,985);
  f.production.retry(id,f.jobs[0].id,{wholePlateConfirmed:true},'retry-fail-50');assert.equal(i.view(f.spool.id).reservedGrams,70);
  assert.equal(f.store.ledger(f.spool.id).filter(m=>m.kind==='consumption').length,1);
});

test('a finished plate with only rejects still consumes full material; manual and external starts cannot silently bypass inventory',async t=>{
  const f=await setup(t),id=f.printer.id;
  await assert.rejects(f.service.command(id,'start',startInput,'bypass-queue'),{code:'QUEUE_REQUIRED'});
  const a=(await start(f)).attempt;report(f,a,'finished',{progress:100});
  await f.production.fail(id,a.id,{reason:'Piezas terminadas con mala calidad'},'quality-failed');
  f.production.collect(id,a.id,{good:0,rejected:4,bedCleared:true,outcome:'failed'},'quality-collect');
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,970);assert.equal(f.production.queue(id).counts.good,0);
  report(f,a,'printing',{currentJob:{name:'Bambu Studio external',file:'external.3mf'},progress:30});
  assert.equal(f.inventory.view(f.spool.id).stockUncertain,true);
  assert.throws(()=>f.inventory.adjust(f.spool.id,{remainingGrams:900,basis:'measured',reason:'Pesado de rollo.'},'weigh-while-run'),{code:'SPOOL_IN_USE'});
  f.transport.states.set(id,fresh());
  await assert.rejects(start(f,f.jobs[1],'after-external'),{code:'MATERIAL_BLOCKED'});
  f.inventory.adjust(f.spool.id,{remainingGrams:900,basis:'measured',reason:'Pesado tras impresion externa.'},'weigh-external');
  assert.equal(f.inventory.view(f.spool.id).stockUncertain,false);assert.equal(f.store.materialPlan(f.jobs[1].id).state,'ready');
});

test('a roll cannot be moved or weighed while an attempt is open; future reservations follow a confirmed physical roll swap',async t=>{
  const f=await setup(t),id=f.printer.id,i=f.inventory;
  const spare=i.create({name:'Spare white',material:'PLA',color:'#FFFFFF',remainingGrams:500,basis:'estimated'},'spare-create');
  const a=(await start(f)).attempt;
  assert.throws(()=>i.bind(id,{spoolId:spare.id,source:'ams',confirmed:true},'mount-midprint'),{code:'PRINTER_BUSY'});
  assert.throws(()=>i.adjust(f.spool.id,{remainingGrams:990,basis:'measured',reason:'Pesado de rollo.'},'weigh-midprint'),{code:'SPOOL_IN_USE'});
  report(f,a,'finished',{progress:100});f.production.collect(id,a.id,collected,'collect-for-swap');
  i.bind(id,{spoolId:spare.id,source:'ams',confirmed:true},'mount-spare-001');
  assert.equal(i.view(f.spool.id).remainingGrams,970);assert.equal(i.view(f.spool.id).reservedGrams,0);assert.equal(i.view(spare.id).reservedGrams,35);
  assert.equal(f.store.attempt(a.id).allocations[0].spoolId,f.spool.id);
});

test('correction appends only a delta, repeated requests do not charge twice, and later weighing supersedes historical corrections',async t=>{
  const f=await setup(t),id=f.printer.id,i=f.inventory,a=(await start(f)).attempt;
  report(f,a,'printing',{progress:50});report(f,a,'failed',{progress:0});assert.equal(i.view(f.spool.id).remainingGrams,985);
  const correction={gramsByFilament:[{filamentId:1,grams:17}],basis:'measured',reason:'Pesada toda la extrusion y desperdicio.'};
  i.correct(id,a.id,correction,'correct-usage');i.correct(id,a.id,correction,'correct-usage');
  assert.equal(i.view(f.spool.id).remainingGrams,983);assert.equal(i.view(f.spool.id).balanceIsEstimate,false);
  f.production.collect(id,a.id,{good:0,rejected:4,bedCleared:true,outcome:'failed'},'correct-collect');
  i.adjust(f.spool.id,{remainingGrams:980,basis:'measured',reason:'Peso neto actual del rollo.'},'reconcile-current');
  i.correct(id,a.id,{...correction,gramsByFilament:[{filamentId:1,grams:19}]},'correct-old-again');
  assert.equal(i.view(f.spool.id).remainingGrams,980);assert.equal(f.store.usage(a.id).totalGrams,19);
  assert.equal(f.store.ledger(f.spool.id)[0].affectsStock,false);
});

test('missing failure progress holds reservation until explicit consumption is supplied atomically with collection',async t=>{
  const f=await setup(t),id=f.printer.id,a=(await start(f)).attempt;
  report(f,a,'failed',{progress:null});
  assert.equal(f.store.usage(a.id).status,'needs_review');assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);assert.equal(f.inventory.view(f.spool.id).reservedGrams,70);
  const c={good:0,rejected:1,outcome:'failed',bedCleared:true};
  assert.throws(()=>f.production.collect(id,a.id,c,'unknown-collect'),{code:'USAGE_REVIEW'});
  assert.equal(f.store.collection(a.id),undefined);assert.ok(f.store.active(id));
  f.production.collect(id,a.id,{...c,usage:{progressPercent:20,reason:'Operador observo veinte por ciento.'}},'unknown-collect');
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,994);assert.equal(f.store.usage(a.id).method,'manual-progress');
});

test('stock and reservations survive reopening SQLite and repeated terminal telemetry after restart does not debit again',async t=>{
  const f=await setup(t),id=f.printer.id,a=(await start(f)).attempt;report(f,a,'printing',{progress:50});
  f.inventory.close();f.production.close();await f.service.close();
  const store=new Store(f.dir),transport=new FakeTransport(),service=new HudsonService({store,transport,vault:fakeVault,config:f.config});
  const production=new ProductionService({store,service,config:f.config}),inventory=new InventoryService({store,production});
  try {
    await service.initialize();assert.equal(inventory.view(f.spool.id).reservedGrams,70);assert.equal(transport.calls.length,0);
    const g={...f,store,transport,service,production,inventory};report(g,a,'failed',{progress:0});
    assert.equal(inventory.view(f.spool.id).remainingGrams,985);
    inventory.close();const another=new InventoryService({store,production});
    try {report(g,a,'failed',{progress:0});assert.equal(another.view(f.spool.id).remainingGrams,985);assert.equal(store.ledger(f.spool.id).filter(m=>m.kind==='consumption').length,1);}
    finally {another.close();}
  } finally {inventory.close();production.close();await service.close();store.close();}
});

test('missing rolls, mismatched material/color, absent weights and changed RFID block a start before upload',async t=>{
  const f=await setup(t),i=f.inventory,id=f.printer.id;
  i.bind(id,{spoolId:null,source:'ams',confirmed:true},'unmount-original');await assert.rejects(start(f),{code:'MATERIAL_BLOCKED'});
  const wrong=i.create({name:'PETG',material:'PETG',remainingGrams:1000,basis:'estimated'},'wrong-material');
  i.bind(id,{spoolId:wrong.id,source:'ams',confirmed:true},'mount-wrong-type');assert.equal(f.store.materialPlan(f.jobs[0].id).issues[0].code,'MATERIAL_MISMATCH');
  const red=i.create({name:'Red PLA',material:'PLA',color:'#FF0000',remainingGrams:1000,basis:'estimated'},'wrong-color');
  i.bind(id,{spoolId:red.id,source:'ams',confirmed:true},'mount-wrong-color');await assert.rejects(start(f),{code:'MATERIAL_BLOCKED'});
  f.transport.states.set(id,fresh({slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',empty:false,tagUid:'tag-original'}]}));
  i.bind(id,{spoolId:f.spool.id,source:'ams',confirmed:true},'mount-original');
  f.transport.states.set(id,fresh({slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',empty:false,tagUid:'tag-other'}]}));
  await assert.rejects(start(f),{code:'ROLL_CHANGED'});assert.equal(f.transport.calls.length,0);
  const item=f.store.libraryItem(f.item.id);item.plates[0].filaments[0].grams=null;
  f.store.db.prepare('UPDATE library SET data=? WHERE id=?').run(JSON.stringify(item),item.id);f.store.transaction(()=>i.replan());
  assert.equal(f.store.materialPlan(f.jobs[0].id).issues[0].code,'UNKNOWN_GRAMS');
});

test('failed upload makes no consumption entry, releases only the active claim and preserves the queue reservation',async t=>{
  const f=await setup(t);await writeFile(f.production.file(f.item.id),'tampered');
  const result=await start(f);assert.equal(result.attempt.state,'not_sent');assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);
  assert.equal(f.store.usage(result.attempt.id),undefined);assert.equal(f.inventory.view(f.spool.id).reservedGrams,70);assert.equal(f.transport.calls.length,0);
});

test('usage larger than inventory keeps a negative balance and raises an alert without losing the physical production record',async t=>{
  const f=await setup(t,{remaining:40,repetitions:1}),id=f.printer.id,a=(await start(f)).attempt;
  report(f,a,'finished',{progress:100});
  f.production.collect(id,a.id,{...collected,usage:{gramsByFilament:[{filamentId:1,grams:45}],basis:'measured',reason:'Pesado incluyendo purga adicional.'}},'negative-collect');
  const s=f.inventory.view(f.spool.id);assert.equal(s.remainingGrams,-5);assert.ok(s.alerts.includes('NEGATIVE_BALANCE'));assert.equal(f.production.queue(id).counts.good,4);
});

test('inventory HTTP endpoints support manual registration, weighing, mounting, ledger and alerts while requiring authorization and request keys',async t=>{
  const f=await setup(t),token='inventory-test-token',server=createApi({...f,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,body,key)=>fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await fetch(base+'/api/inventory')).status,401);
  const input={name:'Nuevo rollo',material:'PLA',remainingGrams:500,basis:'estimated'};
  assert.equal((await call('/api/spools',input)).status,400);
  const added=await call('/api/spools',input,'http-spool-add');assert.equal(added.status,201);const s=(await added.json()).spool;
  assert.equal((await call(`/api/spools/${s.id}/adjust`,{grossGrams:510,tareGrams:200,basis:'measured',reason:'Peso con tara verificada.'},'http-spool-weigh')).status,200);
  assert.equal((await(await call(`/api/spools/${s.id}`)).json()).spool.remainingGrams,310);
  assert.equal((await call(`/api/printers/${f.printer.id}/materials`,{source:'ams',spoolId:s.id,confirmed:true},'http-spool-mount')).status,200);
  const overview=await(await call('/api/inventory')).json();assert.equal(overview.spools.length,2);assert.equal(overview.plans.length,2);
  assert.equal((await(await call(`/api/spools/${s.id}/ledger`)).json()).movements.length,2);
});

test('X2D keeps PETG in AMS and TPU external on their own rolls, with independent partial usage corrections',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const p=await f.service.register({model:'X2D',serial:'TESTX2D-001',ipAddress:'192.168.1.12',nozzleDiameters:[0.4,0.4],accessCode:'test-code'});
  const file=path.join(f.dir,'dual.3mf');
  await writeArchive(file,{model:'X2D',nozzles:['0.4','0.4'],xml:'<config><plate><metadata key="index" value="1"/><filament id="1" type="PETG" color="#2367C9" used_g="20"/><filament id="2" type="TPU" color="#F59A23" used_g="10"/></plate></config>'});
  f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'Dual material');
  const one=inventory.create({name:'PETG blue',material:'PETG',color:'#2367C9',remainingGrams:100,basis:'measured'},'dual-petg-add');
  const two=inventory.create({name:'TPU orange',material:'TPU',color:'#F59A23',remainingGrams:200,basis:'measured'},'dual-tpu-add');
  const slots=[{source:'ams',amsId:0,slotId:1,material:'PETG',empty:false},{source:'external',amsId:254,slotId:0,material:'TPU',empty:false}];
  f.transport.states.set(p.id,fresh({slots}));
  inventory.bind(p.id,{spoolId:one.id,source:'ams',amsId:0,slotId:1,confirmed:true},'dual-petg-mount');
  inventory.bind(p.id,{spoolId:two.id,source:'external',confirmed:true},'dual-tpu-mount');
  const job=production.add(p.id,{libraryId:item.id,plate:1,piecesPerPlate:1,settings:{useAms:true,filamentMapping:[{amsId:0,slotId:1},{amsId:254,slotId:0}],nozzleMapping:[0,1]}},'dual-queue-add').jobs[0];
  assert.equal(inventory.view(one.id).reservedGrams,24);assert.equal(inventory.view(two.id).reservedGrams,13);
  const a=(await production.dispatch(p.id,{jobId:job.id,bedCleared:true,setupConfirmed:true},'dual-dispatch')).attempt;
  const g={...f,printer:p,production,inventory};report(g,a,'printing',{progress:50,slots});report(g,a,'failed',{progress:0,slots});
  assert.equal(inventory.view(one.id).remainingGrams,90);assert.equal(inventory.view(two.id).remainingGrams,195);
  inventory.correct(p.id,a.id,{basis:'measured',reason:'Se pesaron ambos materiales por separado.',gramsByFilament:[{filamentId:1,grams:12},{filamentId:2,grams:2}]},'dual-correction');
  assert.equal(inventory.view(one.id).remainingGrams,88);assert.equal(inventory.view(two.id).remainingGrams,198);
  assert.equal(f.store.usage(a.id).totalGrams,14);
});

test('rolls move between idle printers with exactly one mount and reservations follow the destination, not both queues',async t=>{
  const f=await setup(t),i=f.inventory;
  const p=await f.service.register({model:'P1S',serial:'TESTP1S-SECOND',ipAddress:'192.168.1.13',nozzleDiameters:[0.4],accessCode:'test-code'});
  f.production.add(p.id,{...f.input,repetitions:1,settings:{useAms:false}},'other-queue-add');
  i.bind(p.id,{spoolId:f.spool.id,source:'external',confirmed:true},'move-roll-printer');
  assert.equal(f.store.mounts().filter(m=>m.spoolId===f.spool.id).length,1);
  assert.equal(i.view(f.spool.id).reservedGrams,35);
  assert.equal(f.store.materialPlan(f.jobs[0].id).issues[0].code,'SPOOL_REQUIRED');
  const j=f.production.queue(p.id).pending[0],a=(await f.production.dispatch(p.id,{jobId:j.id,bedCleared:true,setupConfirmed:true},'external-dispatch')).attempt;
  assert.equal(a.allocations[0].source,'external');
  assert.throws(()=>i.bind(f.printer.id,{spoolId:f.spool.id,source:'ams',confirmed:true},'move-active-roll'),{code:'SPOOL_IN_USE'});
});

test('progress after failed is pressed is included until stop confirmation, and stale/foreign reports do not consume stock',async t=>{
  const f=await setup(t),id=f.printer.id,a=(await start(f)).attempt;
  report(f,a,'printing',{progress:50});await f.production.fail(id,a.id,{reason:'Falla observada'},'fail-progress-capture');
  report(f,a,'printing',{progress:60});report(f,a,'failed',{fresh:false,progress:100});
  assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);
  report(f,a,'failed',{progress:0});assert.equal(f.store.usage(a.id).totalGrams,18);assert.equal(f.inventory.view(f.spool.id).remainingGrams,982);
});

test('zero gram metadata is preserved while absent gram metadata stays unknown, and shared-source sums cannot overdraw before starting',async t=>{
  const f=await setup(t,{remaining:40,repetitions:1}),i=f.inventory,id=f.printer.id;
  f.production.cancel(id,f.jobs[0].id,{},'cancel-for-multi');
  const file=path.join(f.dir,'shared.3mf');
  await writeArchive(file,{xml:'<config><plate><metadata key="index" value="1"/><filament id="1" type="PLA" used_g="20"/><filament id="2" type="PLA" used_g="20"/><filament id="3" type="PLA" used_g="0"/></plate></config>'});
  const item=await f.production.importFile(file,'Shared source');assert.equal(item.plates[0].filaments[2].grams,0);
  const job=f.production.add(id,{libraryId:item.id,plate:1,piecesPerPlate:1,settings:{useAms:true,amsMapping:[0,0,0]}},'shared-add').jobs[0];
  assert.equal(i.view(f.spool.id).reservedGrams,48);
  await assert.rejects(start(f,job,'shared-dispatch'),{code:'MATERIAL_BLOCKED'});
  assert.equal(f.transport.calls.length,0);
});

test('a policy change updates queued reservations but cannot reduce the already captured in-flight margin',async t=>{
  const f=await setup(t),i=f.inventory,a=(await start(f)).attempt;
  assert.equal(a.allocations[0].reserveMg,35000);
  i.configure({reservePercent:0,reserveGrams:0},'change-reserve-policy');
  assert.equal(i.view(f.spool.id).reservedGrams,65);assert.equal(f.store.attempt(a.id).allocations[0].reserveMg,35000);
  report(f,a,'finished',{progress:100});assert.equal(i.view(f.spool.id).reservedGrams,30);
});

test('a detectable RFID swap during printing requires material review instead of silently deducting the original roll',async t=>{
  const f=await setup(t),id=f.printer.id;
  const slots=tagUid=>[{source:'ams',amsId:0,slotId:0,material:'PLA',empty:false,tagUid}];
  f.transport.states.set(id,fresh({slots:slots('original-tag')}));
  f.inventory.bind(id,{spoolId:f.spool.id,source:'ams',confirmed:true},'confirm-tag');
  const a=(await start(f)).attempt;report(f,a,'printing',{progress:50,slots:slots('new-tag')});report(f,a,'finished',{progress:100,slots:slots('new-tag')});
  assert.equal(f.store.usage(a.id).status,'needs_review');assert.equal(f.inventory.view(f.spool.id).remainingGrams,1000);
  assert.equal(f.inventory.view(f.spool.id).stockUncertain,true);
  assert.throws(()=>f.inventory.correct(id,a.id,{progressPercent:100,reason:'Progreso total.'},'roll-progress-fix'),{code:'USAGE_REVIEW'});
});
