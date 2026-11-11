import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {fixture,fresh,writeArchive,FakeTransport,fakeVault} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {HudsonService} from '../src/service.mjs';
import {Store} from '../src/store.mjs';
import {buildStart} from '../src/commands.mjs';
import {filamentChoices,filamentPicker} from '../public/ipad-inventory.js';
import {plannedSpoolChoices,plannedChanges} from '../public/planned-filament.js';
import {operatorState,filamentAlert} from '../public/ipad-state.js';

const external={source:'external',amsId:254,slotId:0};
const esc=v=>String(v??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
async function setup(t,{model='P1S',grams=30,spool=false,remaining=10}={}) {
  const f=await fixture(t);
  if(model!=='P1S')f.printer=await f.service.register({name:model,model,serial:'OTHERDEVICE123',ipAddress:'192.168.1.11',accessCode:'test-code',nozzleDiameters:model==='X2D'?[0.4,0.4]:[0.4]});
  const production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const file=path.join(f.dir,'unrestricted.gcode.3mf');
  await writeArchive(file,{model,nozzles:model==='X2D'?['0.4','0.4']:['0.4'],xml:`<config><plate><metadata key="index" value="1"/><filament id="1" type="PLA" color="#FFFFFF"${grams===null?'':` used_g="${grams}"`}/></plate></config>`});
  f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'Unrestricted fixture');
  inventory.configure({reservePercent:10,reserveGrams:2,enforceFilamentChecks:false},'disable-checks-001');
  let roll;
  if(spool){
    roll=inventory.create({name:'Negro',material:'PETG',color:'#000000',remainingGrams:remaining,basis:'estimated'},'create-roll-001');
    inventory.bind(f.printer.id,{...external,spoolId:roll.id,confirmed:true},'mount-roll-001');
    f.store.saveSpool({...f.store.spool(roll.id),stockUncertain:true});
  }
  f.transport.states.set(f.printer.id,fresh({slots:[]}));
  const input={libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:false,filamentMapping:[{amsId:254,slotId:0}],...(model==='X2D'?{nozzleMapping:[0]}:{})}};
  const jobs=production.add(f.printer.id,input,'queue-unrestricted-001').jobs;
  return {...f,production,inventory,item,roll,input,jobs};
}
const start=(f,key='start-unrestricted-001')=>f.production.dispatch(f.printer.id,{jobId:f.jobs[0].id,bedCleared:true,setupConfirmed:true},key);
function report(f,a,status,patch={}) {
  const packet=f.store.request(f.printer.id,a.startKey).packet.print;
  const s=fresh({status,slots:[],currentJob:{name:packet.subtask_name,file:packet.file},...patch});
  f.transport.states.set(f.printer.id,s);f.transport.emit('telemetry',f.printer.id,s);
}

for(const model of ['P1S','A1','X1C','X2D'])test(`${model}: queue and Start work without a registered spool or reported filament; collection never starts the next job`,async t=>{
  const f=await setup(t,{model}),id=f.printer.id;
  assert.equal(f.service.list().find(p=>p.id===id).enforceFilamentChecks,false);
  assert.ok(f.production.queue(id).pending.every(j=>j.materialPlan.state==='ready'&&!j.materialPlan.issues.length));
  assert.equal(f.transport.calls.length,0);
  const a=(await start(f)).attempt;
  assert.equal(f.transport.calls.length,1);assert.deepEqual(a.allocations,[]);assert.deepEqual(a.untrackedFilamentIds,[1]);
  report(f,a,'printing',{progress:20});report(f,a,'finished',{progress:100});
  const q=f.production.queue(id),p=f.service.list().find(p=>p.id===id);
  assert.equal(q.active.materialUsage.status,'untracked');assert.equal(q.active.operatorCollection.available,true);
  assert.equal(operatorState(p,q).canPrint,true);
  f.production.operatorCollect(id,a.id,{outcome:'finished',retry:false,bedCleared:true,printerChecked:true},'operator-collect-001');
  assert.equal(f.production.queue(id).active,null);assert.equal(f.production.queue(id).pending.length,1);
  assert.equal(f.transport.calls.length,1);assert.equal(f.store.spools().length,0);
});

test('mismatched color/material, uncertain/insufficient balances and AMS slot reports do not block; known consumption still settles once',async t=>{
  const f=await setup(t,{spool:true}),id=f.printer.id;
  // Exercise AMS as well as the external-source cases above.
  f.inventory.bind(id,{source:'ams',amsId:0,slotId:0,spoolId:f.roll.id,confirmed:true},'remount-ams-001');
  for(const j of f.jobs)f.production.edit(id,j.id,{settings:{useAms:true,amsMapping:[0]}},`edit-ams-${j.id}`);
  f.transport.states.set(id,fresh({slots:[{source:'ams',amsId:0,slotId:0,material:'ABS',color:'FF0000FF',empty:true}]}));
  assert.ok(f.production.queue(id).pending.every(j=>j.materialPlan.state==='ready'));
  const a=(await start(f)).attempt;assert.equal(a.allocations[0].spoolId,f.roll.id);
  report(f,a,'printing',{progress:50});report(f,a,'finished',{progress:100});report(f,a,'finished',{progress:100});
  assert.equal(f.inventory.view(f.roll.id).remainingGrams,-20);
  assert.equal(f.store.ledger(f.roll.id).filter(l=>l.kind==='consumption').length,1);
  assert.equal(f.production.queue(id).pending[0].materialPlan.state,'ready');
});

test('missing grams leave consumption untracked without inventing stock movements',async t=>{
  const f=await setup(t,{spool:true,grams:null}),id=f.printer.id;
  const a=(await start(f)).attempt;assert.deepEqual(a.allocations,[]);
  report(f,a,'finished',{progress:100});assert.equal(f.store.usage(a.id).status,'untracked');
  assert.equal(f.store.ledger(f.roll.id).length,1);
});

test('a changed RFID does not block Start or charge the previously registered roll',async t=>{
  const f=await setup(t,{spool:true}),id=f.printer.id;
  const mount=f.store.mount(id,'external:254:0');
  f.store.unmount(f.roll.id);f.store.saveMount({...mount,observedTagUid:'old-tag'});
  f.transport.states.set(id,fresh({slots:[{...external,material:'PLA',empty:false,tagUid:'new-tag'}]}));
  const a=(await start(f)).attempt;assert.deepEqual(a.allocations,[]);
  report(f,a,'finished',{progress:100});assert.equal(f.store.usage(a.id).status,'untracked');
  assert.equal(f.store.ledger(f.roll.id).length,1);
});

test('a pending replacement no longer blocks Start or silently moves a physical roll',async t=>{
  const f=await setup(t,{spool:true}),id=f.printer.id;
  const next=f.inventory.create({name:'Blanco futuro',material:'ABS',color:'#FFFFFF',remainingGrams:0,basis:'estimated'},'future-roll-001');
  f.production.edit(id,f.jobs[0].id,{materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:next.id}]}},'plan-change-001');
  const before=f.store.mounts(),head=f.production.queue(id).pending[0];assert.deepEqual(plannedChanges(head),[]);
  const a=(await start(f)).attempt;assert.equal(a.allocations[0].spoolId,f.roll.id);
  assert.deepEqual(f.store.mounts(),before);assert.equal(f.inventory.view(next.id).remainingGrams,0);
});

test('unknown failed consumption allows iPad collection while leaving the balance marked for review',async t=>{
  const f=await setup(t,{spool:true}),id=f.printer.id,a=(await start(f)).attempt;
  report(f,a,'printing');report(f,a,'failed');
  const q=f.production.queue(id);
  assert.equal(q.active.materialUsage.status,'untracked');assert.equal(q.active.operatorCollection.available,true);
  assert.equal(operatorState(f.service.list().find(p=>p.id===id),q).collection,true);
  f.production.operatorCollect(id,a.id,{outcome:'failed',retry:false,bedCleared:true,printerChecked:true},'collect-unknown-001');
  assert.equal(f.store.ledger(f.roll.id).length,1);assert.equal(f.inventory.view(f.roll.id).stockUncertain,true);
  assert.equal(f.production.queue(id).pending[0].materialPlan.state,'ready');
});

test('global policy persists through restart and margin edits without altering jobs or resending commands',async t=>{
  const f=await setup(t,{spool:true});
  const snapshot=f.store.jobs(f.printer.id);
  f.inventory.configure({reservePercent:15,reserveGrams:1},'edit-margin-001');
  const store=new Store(f.dir),transport=new FakeTransport(),service=new HudsonService({store,transport,vault:fakeVault,config:f.config});
  const production=new ProductionService({store,service,config:f.config}),inventory=new InventoryService({store,production});
  try {
    assert.equal(inventory.enforceFilamentChecks(),false);assert.equal(inventory.policy().reservePercent,15);
    assert.deepEqual(store.jobs(f.printer.id),snapshot);assert.ok(service.list().every(p=>p.enforceFilamentChecks===false));
    assert.equal(transport.calls.length,0);assert.equal(f.transport.calls.length,0);
  }finally{inventory.close();production.close();await service.close();store.close();}
});

test('unrestricted filament does not bypass fresh state, bed confirmation, packet mappings, model or nozzle compatibility',async t=>{
  const f=await setup(t),id=f.printer.id;
  f.transport.states.set(id,fresh({fresh:false}));await assert.rejects(start(f),{code:'WRONG_STATE'});
  f.transport.states.set(id,fresh({status:'printing'}));await assert.rejects(start(f),{code:'WRONG_STATE'});
  f.transport.states.set(id,fresh());
  await assert.rejects(f.production.dispatch(id,{jobId:f.jobs[0].id,bedCleared:false,setupConfirmed:true},'no-bed-001'),{code:'SETUP_REQUIRED'});
  const original=f.store.job(f.jobs[0].id);
  f.store.saveJob({...original,settings:{useAms:true,amsMapping:[]}});await assert.rejects(start(f),{code:'AMS_MAPPING'});
  f.store.saveJob(original);
  const item=f.store.libraryItem(f.item.id);
  for(const patch of [{model:'A1'},{nozzleDiameters:[0.6]}]){
    assert.throws(()=>buildStart({printer:f.printer,status:fresh(),transfer:{remoteName:'test.3mf',archive:{...item,plates:item.plates.map(p=>({...p,...patch}))}},input:{plate:1,bedCleared:true,setupConfirmed:true,...f.input.settings},enforceFilamentChecks:false}),{code:patch.model?'WRONG_MODEL':'WRONG_NOZZLE'});
  }
  assert.equal(f.transport.calls.length,0);
});

test('PC and iPad selectors accept loaded, empty, uncertain, mismatched and unregistered positions without warning gates',()=>{
  for(const model of ['P1S','A1','X1C','X2D']) {
    const p={id:'printer',model,enforceFilamentChecks:false,telemetry:fresh({slots:[{...external,material:'ABS',empty:true}]})};
    const f={id:1,type:'PLA',color:'#FFFFFF',grams:71};
    const spool={id:'roll',name:'Negro',material:'PETG',color:'#000000',stockUncertain:true,remainingGrams:0,mount:{printerId:p.id,...external}};
    for(const spools of [[],[spool]]) {
      assert.ok(filamentChoices(p,spools,f).every(s=>s.usable&&!s.reason));
      const html=filamentPicker({printer:p,spools,filament:f,esc});
      assert.doesNotMatch(html,/disabled|Actualiza el saldo de filamento|No hay una bobina cargada compatible/);
    }
    assert.equal(plannedSpoolChoices(p,[spool],f,'external:254:0')[0].usable,true);
    assert.ok(filamentChoices({...p,telemetry:fresh({slots:[]})},[],f).length>0);
  }
  assert.equal(filamentAlert({enforceFilamentChecks:false,state:'blocked',issues:[{code:'STOCK_REVIEW'}]},esc),'');
});
