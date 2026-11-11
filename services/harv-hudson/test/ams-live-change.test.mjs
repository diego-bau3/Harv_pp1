import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fixture,fresh,fakeVault} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {BambuTransport} from '../src/transport.mjs';
import {normalizeTelemetry} from '../src/telemetry.mjs';
import {reportedFilamentUse,filamentPositionBlock} from '../public/filament-access.js';
import {createIpadInventory,prepareFilamentAssignment,confirmFilamentAssignment,openAssignFilamentForm} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';
import {createApi} from '../src/api.mjs';

const ams=slotId=>({source:'ams',amsId:0,slotId});
const raw=(current=0,target=current)=>({gcode_state:'RUNNING',ams:{tray_now:String(current),tray_tar:String(target),ams:[{id:0,tray:[0,1,2,3].map(id=>({id,tray_type:'PLA',tray_color:'FFFFFFFF'}))}]}});
const status=(current=0,target=current)=>fresh({...normalizeTelemetry(raw(current,target)),filamentUseFresh:true});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function setup(t){
 const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});t.after(()=>{inventory.close();production.close();});
 const rolls=inventory.createBatch({material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',quantity:4,remainingGrams:1000,basis:'estimated'},'live-change-seed').spools;
 for(let slotId=0;slotId<3;slotId++)inventory.bind(f.printer.id,{...ams(slotId),spoolId:rolls[slotId].id,confirmed:true},`initial-mount-${slotId}`);
 const job={id:'live-job',rootId:'live-job',printerId:f.printer.id,state:'active',position:5,settings:{useAms:true,amsMapping:[0]},pieces:1};f.store.saveJob(job);
 const attempt={id:'live-attempt',jobId:job.id,printerId:f.printer.id,state:'printing',observedStartedAt:new Date().toISOString(),allocations:[{...ams(0),sourceKey:'ams:0:0',spoolId:rolls[0].id,filamentId:1,plannedMg:10000,reserveMg:10000}]};
 f.store.saveAttempt(attempt);f.store.claim(f.printer.id,attempt.id);f.transport.states.set(f.printer.id,status());
 const snapshot=()=>({printers:[{...f.printer,telemetry:f.transport.status(f.printer.id)}],queues:[{printerId:f.printer.id,active:{attempt:f.store.active(f.printer.id)}}],inventory:inventory.overview()});
 return {...f,production,inventory,rolls,attempt,snapshot};
}
test('legacy and dual-nozzle reports identify occupied and loading slots including AMS HT and external inputs',()=>{
 assert.deepEqual(reportedFilamentUse(raw('5','6')).current,['ams:1:1']);assert.deepEqual(reportedFilamentUse(raw('5','6')).target,['ams:1:2']);
 assert.deepEqual(reportedFilamentUse(raw('128')).current,['ams:128:0']);assert.deepEqual(reportedFilamentUse(raw('254')).current,['external:254:0']);
 assert.deepEqual(reportedFilamentUse(raw('255')).current,[]);
 const dual={device:{extruder:{state:2,info:[{id:0,snow:0,star:0},{id:1,snow:257,star:258}]}}};
 const use=reportedFilamentUse(dual);assert.equal(use.known,true);assert.deepEqual(use.current,['ams:0:0','ams:1:1']);assert.deepEqual(use.target,['ams:0:0','ams:1:2']);
 const p={model:'X2D',telemetry:{...status(),filamentUse:use}};
 assert.match(filamentPositionBlock({printer:p,source:ams(0)}),/En uso/);
 assert.match(filamentPositionBlock({printer:p,source:{...ams(1),amsId:1}}),/En uso/);
 assert.match(filamentPositionBlock({printer:p,source:{...ams(2),amsId:1}}),/cargando/);
 assert.equal(filamentPositionBlock({printer:p,source:ams(3)}),'');
 assert.match(filamentPositionBlock({printer:{model:'X2D',telemetry:status()},source:ams(3)}),/lectura/);
 for(const malformed of [{device:{extruder:{state:2,info:[{id:0,snow:0,star:0}]}}},{ams:{tray_now:'',tray_tar:'0'}},{ams:{tray_now:'bad',tray_tar:'0'}},{device:{extruder:{state:2,info:[{id:0,snow:0,star:0},{id:0,snow:0,star:0}]}}}])assert.equal(reportedFilamentUse(malformed).known,false);
});
test('API allows changing an unused AMS position during printing, preserves active allocations and never commands a printer',async t=>{
 const f=await setup(t),before={jobs:f.store.jobs(f.printer.id),attempt:f.store.active(f.printer.id),ledger:f.rolls.map(s=>f.store.ledger(s.id))};
 const server=createApi({...f,token:'ams-test-token'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base=`http://127.0.0.1:${server.address().port}`,body={...ams(1),spoolId:f.rolls[3].id,confirmed:true};
 const response=await fetch(base+`/api/printers/${f.printer.id}/materials`,{method:'POST',headers:{Authorization:'Bearer ams-test-token','Content-Type':'application/json','Idempotency-Key':'live-ams-switch'},body:JSON.stringify(body)});
 assert.equal(response.status,200,await response.text());assert.equal(f.inventory.view(f.rolls[3].id).mount.slotId,1);assert.equal(f.inventory.view(f.rolls[1].id).mount,null);
 assert.deepEqual(f.store.jobs(f.printer.id),before.jobs);assert.deepEqual(f.store.active(f.printer.id),before.attempt);assert.deepEqual(f.rolls.map(s=>f.store.ledger(s.id)),before.ledger);assert.equal(f.transport.calls.length,0);
 f.inventory.bind(f.printer.id,body,'live-ams-switch');assert.equal(f.store.mounts().filter(m=>m.spoolId===f.rolls[3].id).length,1);
 assert.equal((await fetch(base+'/filament-access.js')).status,200);
});
test('active, loading, external, stale and command-pending changes are rejected atomically, including moves from another printer',async t=>{
 const f=await setup(t),id=f.printer.id,change=(slotId,key)=>f.inventory.bind(id,{...ams(slotId),spoolId:f.rolls[3].id,confirmed:true},key);
 const mounts=JSON.stringify(f.store.mounts()),ledger=f.rolls.map(s=>f.store.ledger(s.id));
 assert.throws(()=>change(0,'active-block'),/En uso/);
 f.transport.states.set(id,status(0,1));assert.throws(()=>change(1,'loading-block'),/cargando/);
 f.transport.states.set(id,{...status(),filamentUseFresh:false});assert.throws(()=>change(1,'stale-slot-block'),/lectura/);
 f.transport.states.set(id,{...status(),fresh:false});assert.throws(()=>change(1,'offline-block'),/conexión/);
 f.transport.states.set(id,status());assert.throws(()=>f.inventory.bind(id,{source:'external',spoolId:f.rolls[3].id,confirmed:true},'external-block'),/externo/);
 f.service.locks.add(id);assert.throws(()=>change(1,'command-lock-block'),/pendiente/);f.service.locks.delete(id);
 const other=await f.service.register({name:'Other',model:'A1',serial:'TESTSECONDAMS',ipAddress:'192.168.1.12',nozzleDiameters:[0.4],accessCode:'test-code'});
 assert.throws(()=>f.inventory.bind(other.id,{...ams(1),spoolId:f.rolls[0].id,confirmed:true},'moving-active-block'),/En uso/);
 assert.equal(JSON.stringify(f.store.mounts()),mounts);assert.deepEqual(f.rolls.map(s=>f.store.ledger(s.id)),ledger);assert.equal(f.transport.calls.length,0);
});
test('an unused slot can be emptied while paused and moving an unused spool between printers keeps one assignment',async t=>{
 const f=await setup(t),id=f.printer.id;f.transport.states.set(id,{...status(),status:'paused'});
 f.inventory.bind(id,{...ams(2),spoolId:null,confirmed:true},'empty-unused-slot');assert.equal(f.inventory.view(f.rolls[2].id).mount,null);
 const other=await f.service.register({name:'Other',model:'A1',serial:'TESTOTHERAMS',ipAddress:'192.168.1.12',nozzleDiameters:[0.4],accessCode:'test-code'});
 f.inventory.bind(other.id,{...ams(3),spoolId:f.rolls[1].id,confirmed:true},'move-unused-slot');assert.equal(f.inventory.view(f.rolls[1].id).mount.printerId,other.id);assert.equal(f.store.mount(id,'ams:0:1'),undefined);
 assert.equal(f.transport.calls.length,0);
});
test('swapping an inactive material used by this plate preserves original allocation and marks ambiguous consumption instead of charging the wrong spool',async t=>{
 const f=await setup(t),id=f.printer.id,a=f.store.active(id);a.allocations.push({...ams(1),sourceKey:'ams:0:1',spoolId:f.rolls[1].id,filamentId:2,plannedMg:5000,reserveMg:5000});f.store.saveAttempt(a);
 f.inventory.bind(id,{...ams(1),spoolId:f.rolls[3].id,confirmed:true},'swap-later-material');
 const changed=f.store.active(id);assert.deepEqual(changed.allocations,a.allocations);assert.equal(changed.materialRoutingUncertain,true);assert.equal(changed.filamentChanges[0].toSpoolId,f.rolls[3].id);
 f.inventory.configure({reservePercent:10,reserveGrams:2,enforceFilamentChecks:false},'keep-unrestricted');
 const usage=f.inventory.finish(changed,'finished');assert.equal(usage.status,'untracked');assert.equal(f.inventory.view(f.rolls[1].id).remainingGrams,1000);assert.equal(f.inventory.view(f.rolls[3].id).remainingGrams,1000);assert.equal(f.inventory.view(f.rolls[3].id).stockUncertain,true);
});
test('both PC and iPad mark the live position and recheck a newly active slot before confirmation',async t=>{
 const f=await setup(t),state={connected:true,data:f.snapshot()};let form,writes=0;
 const ui=createIpadInventory({state,esc,openForm:(...args)=>form=args,mutate:async()=>writes++,refresh:async()=>{state.data=f.snapshot();},toast(){}});
 for(const lang of ['es','en']){setLanguage(lang,{reload:false});try{
  state.data=f.snapshot();ui.change(f.printer.id,'ams:0:0');assert.equal(form[3].hideSubmit,true);assert.match(form[1],lang==='en'?/In use/:/En uso/);
  ui.change(f.printer.id,'ams:0:1');assert.equal(form[3].hideSubmit,false);assert.match(form[1],/name="spoolId"/);assert.match(ui.loaded(state.data.printers[0],state.data.queues[0]),lang==='en'?/In use/:/En uso/);
  let board;await openAssignFilamentForm({state,esc,openForm:(...args)=>board=args,readSnapshot:async()=>f.snapshot(),mutate:async()=>writes++,toast(){}});
  assert.match(board[1],/data-assign-slot="ams:0:0"[^>]*disabled/);assert.doesNotMatch(board[1],/data-assign-slot="ams:0:1"[^>]*disabled/);
 }finally{setLanguage('es',{reload:false});}}
 const proposal=prepareFilamentAssignment(f.snapshot(),f.rolls[3].id,f.printer.id,'ams:0:1');ui.change(f.printer.id,'ams:0:1');f.transport.states.set(f.printer.id,status(1));
 await assert.rejects(()=>form[2]({spoolId:f.rolls[3].id,confirmed:'on'}),/En uso/);
 await assert.rejects(()=>confirmFilamentAssignment({state,proposal,confirmed:true,readSnapshot:async()=>f.snapshot(),mutate:async()=>writes++}),/En uso/);
 assert.equal(writes,0);
});
test('routing freshness expires independently from ordinary telemetry and reconnect discards prior slot readings',async t=>{
 const f=await fixture(t);class Client extends EventEmitter{connected=true;subscribe(t,o,cb){cb(null);}publish(t,p,o,cb){cb(null);}async endAsync(){}}
 const client=new Client(),transport=new BambuTransport({...f,vault:fakeVault,mqttConnect:()=>client});t.after(()=>transport.close());await transport.connect(f.printer);client.emit('connect');
 const emit=print=>client.emit('message',`device/${f.printer.serial}/report`,Buffer.from(JSON.stringify({print})));
 emit(raw());assert.equal(transport.status(f.printer.id).filamentUseFresh,true);
 transport.sessions.get(f.printer.id).filamentSeen.legacy='2000-01-01T00:00:00Z';emit({gcode_state:'RUNNING',nozzle_temper:220});assert.equal(transport.status(f.printer.id).fresh,true);assert.equal(transport.status(f.printer.id).filamentUseFresh,false);
 emit(raw(1));assert.equal(transport.status(f.printer.id).filamentUseFresh,true);assert.deepEqual(transport.status(f.printer.id).filamentUse.current,['ams:0:1']);
 client.emit('close');client.emit('connect');emit({gcode_state:'RUNNING'});assert.equal(transport.status(f.printer.id).filamentUseFresh,false);assert.equal(transport.status(f.printer.id).filamentUse.known,false);
});
