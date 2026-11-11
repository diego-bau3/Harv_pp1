import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fixture,fresh,writeArchive } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { InventoryService } from '../src/inventory.mjs';
import { createApi } from '../src/api.mjs';
import { plannedSpoolChoices,plannedFilamentPicker,plannedChanges,plannedChangeSummary } from '../public/planned-filament.js';
import { operatorState } from '../public/ipad-state.js';
import { createIpad } from '../public/ipad.js';
import { Store } from '../src/store.mjs';

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const external={source:'external',amsId:254,slotId:0};
async function setup(t) {
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const file=path.join(f.dir,'white.gcode.3mf');await writeArchive(file);f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'Placa blanca');
  const add=(name,color,material='PLA')=>inventory.create({name,color,material,remainingGrams:1000,basis:'measured'},`add-roll-${name}`);
  const black=add('Negro01','#000000'),white=add('Blanco01','#FFFFFF'),blue=add('Azul01','#306BC8'),petg=add('PETG01','#FFFFFF','PETG');
  const status=fresh({slots:[{...external,material:'PLA',color:'000000FF',empty:false}]});f.transport.states.set(f.printer.id,status);
  inventory.bind(f.printer.id,{...external,spoolId:black.id,confirmed:true},'mount-black-first');
  const input={libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:1,settings:{useAms:false,filamentMapping:[{amsId:254,slotId:0}]},
    materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:white.id}]}};
  const addJob=(body=input,key='planned-add-first')=>production.add(f.printer.id,body,key).jobs[0];
  return {...f,production,inventory,item,input,black,white,blue,petg,addJob,status};
}
const confirm=(f,j,key='confirm-planned-001')=>f.inventory.confirmChange(f.printer.id,j.id,{changeId:j.materialChange.id,confirmed:true},key);

test('planning a future white roll preserves the mounted black roll and reserves white stock without consuming it',async t=>{
  const f=await setup(t),j=f.addJob(),q=f.production.queue(f.printer.id),plan=q.pending[0].materialPlan;
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.black.id);
  assert.equal(plan.state,'blocked');assert.equal(plan.issues[0].code,'FILAMENT_CHANGE_REQUIRED');
  assert.equal(plan.issues[0].target.name,'Blanco01');assert.equal(plan.issues[0].loaded.name,'Negro01');
  assert.equal(f.inventory.view(f.white.id).reservedGrams,35);assert.equal(f.inventory.view(f.white.id).remainingGrams,1000);
  assert.equal(f.inventory.view(f.black.id).reservedGrams,0);assert.equal(f.transport.calls.length,0);
  await assert.rejects(f.production.dispatch(f.printer.id,{jobId:j.id,bedCleared:true,setupConfirmed:true},'try-start-early'),{code:'MATERIAL_BLOCKED'});
  assert.equal(f.store.active(f.printer.id),undefined);assert.equal(f.transport.calls.length,0);
  assert.equal(f.production.add(f.printer.id,f.input,'planned-add-first').jobs[0].id,j.id);
});

test('explicit physical confirmation updates the mount exactly once, keeps queue order and enables a separately confirmed Start',async t=>{
  const f=await setup(t),j=f.addJob(),next=f.addJob(f.input,'planned-add-second'),order=f.store.jobs(f.printer.id).map(j=>[j.id,j.position,j.state]);
  confirm(f,j);confirm(f,j);
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.white.id);
  assert.equal(f.inventory.view(f.black.id).mount,null);
  assert.deepEqual(f.store.jobs(f.printer.id).map(j=>[j.id,j.position,j.state]),order);
  assert.equal(f.production.queue(f.printer.id).pending[0].materialPlan.state,'ready');
  assert.equal(f.production.queue(f.printer.id).pending[1].materialPlan.state,'ready');
  assert.equal(f.inventory.view(f.white.id).reservedGrams,70);assert.equal(f.inventory.view(f.white.id).remainingGrams,1000);
  assert.equal(f.transport.calls.length,0);
  const result=await f.production.dispatch(f.printer.id,{jobId:j.id,bedCleared:true,setupConfirmed:true},'start-after-change');
  assert.equal(result.attempt.allocations[0].spoolId,f.white.id);assert.equal(f.transport.calls.length,1);
  assert.equal(f.store.job(next.id).state,'queued');
});

test('a chosen replacement color changes only the job requirement, never the sliced archive or material type',async t=>{
  const f=await setup(t),archive=JSON.stringify(f.store.libraryItem(f.item.id)),j=f.addJob({...f.input,materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:f.blue.id}]}});
  assert.equal(j.materialChange.filaments[0].color,'#306BC8');assert.equal(j.materialChange.filaments[0].originalColor,'#FFFFFF');
  confirm(f,j);assert.equal(f.production.queue(f.printer.id).pending[0].materialPlan.state,'ready');
  assert.equal(JSON.stringify(f.store.libraryItem(f.item.id)),archive);
  assert.throws(()=>f.addJob({...f.input,materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:f.petg.id}]}},'bad-material-001'),{code:'MATERIAL_MISMATCH'});
});

test('confirmation rejects old edits, reordered heads, stale printers, missing material and missing checkboxes',async t=>{
  const f=await setup(t),j=f.addJob(),other=f.addJob(f.input,'planned-add-other');
  assert.throws(()=>confirm(f,other),{code:'QUEUE_CHANGED'});
  assert.throws(()=>f.inventory.confirmChange(f.printer.id,j.id,{changeId:j.materialChange.id},'missing-check'),{code:'SETUP_REQUIRED'});
  for(const patch of [{fresh:false},{status:'printing'},{status:'paused'},{slots:[]},{slots:[{...external,material:'PETG',empty:false}]}]) {
    f.transport.states.set(f.printer.id,{...f.status,...patch});assert.throws(()=>confirm(f,j));
    assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.black.id);
  }
  f.transport.states.set(f.printer.id,f.status);
  f.production.edit(f.printer.id,j.id,{materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:f.blue.id}]}},'edit-planned-roll');
  assert.throws(()=>confirm(f,j),{code:'FILAMENT_CHANGE_CHANGED'});
  assert.equal(f.transport.calls.length,0);
});

test('an open production attempt cannot be bypassed by confirming a future filament change',async t=>{
  const f=await setup(t),j=f.addJob();confirm(f,j);
  const result=await f.production.dispatch(f.printer.id,{jobId:j.id,bedCleared:true,setupConfirmed:true},'start-current-job');
  const next=f.addJob({...f.input,materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:f.blue.id}]}},'add-next-blue');
  const allocation=JSON.stringify(f.store.attempt(result.attempt.id).allocations);
  assert.throws(()=>confirm(f,next),{code:'COLLECTION_REQUIRED'});
  assert.equal(JSON.stringify(f.store.attempt(result.attempt.id).allocations),allocation);
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.white.id);
});

test('future reservations release on cancel, remain subject to shortages, and disabling the plan restores file color validation',async t=>{
  const f=await setup(t),j=f.addJob({...f.input,repetitions:30}),all=f.store.jobs(f.printer.id);
  assert.equal(f.inventory.view(f.white.id).reservedGrams,1050);
  assert.ok(f.production.queue(f.printer.id).pending.at(-1).materialPlan.issues.some(i=>i.code==='INSUFFICIENT_FILAMENT'));
  f.production.cancel(f.printer.id,all.at(-1).id,{},'cancel-last-job');assert.equal(f.inventory.view(f.white.id).reservedGrams,1015);
  f.production.edit(f.printer.id,j.id,{materialChange:null},'remove-change-plan');
  assert.equal(f.store.job(j.id).materialChange,null);
  assert.equal(f.production.queue(f.printer.id).pending[0].materialPlan.issues[0].code,'COLOR_MISMATCH');
});

test('foreign mounts, missing IDs and duplicate source/spool mappings are rejected without creating jobs',async t=>{
  const f=await setup(t);
  for(const materialChange of [{enabled:true,filaments:[]},{enabled:true,filaments:[{filamentId:2,spoolId:f.white.id}]},{enabled:true,filaments:[{filamentId:1,spoolId:'missing'}]}])assert.throws(()=>f.addJob({...f.input,materialChange}));
  f.store.saveMount({...external,sourceKey:'external:254:0',printerId:'another-printer',spoolId:f.white.id,confirmedAt:new Date().toISOString()});
  assert.throws(()=>f.addJob(),{code:'SPOOL_MOUNTED_ELSEWHERE'});assert.equal(f.store.jobs(f.printer.id).length,0);
});

test('confirmation rolls back all mount changes on a planning failure',async t=>{
  const f=await setup(t),j=f.addJob(),original=f.inventory.replan;
  f.inventory.replan=()=>{throw Error('synthetic failure');};
  assert.throws(()=>confirm(f,j),/synthetic/);f.inventory.replan=original;
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.black.id);assert.equal(f.inventory.view(f.white.id).mount,null);
});

test('inventory circle choices expose compatible unmounted colors, escape labels, and preserve physical mounts while rendering',async t=>{
  const f=await setup(t),spools=f.inventory.overview().spools,p={...f.printer,telemetry:f.status},filament=f.item.plates[0].filaments[0],snapshot=JSON.stringify(spools);
  const choices=plannedSpoolChoices(p,spools,filament,'external:254:0');
  assert.ok(choices.find(s=>s.id===f.white.id).usable);assert.ok(choices.find(s=>s.id===f.blue.id).usable);assert.equal(choices.find(s=>s.id===f.petg.id).usable,false);
  spools.find(s=>s.id===f.blue.id).name='<unsafe>';
  const html=plannedFilamentPicker({printer:p,spools,filament,esc});
  assert.match(html,/name="planned-spool-1"/);assert.match(html,/Ahora: Negro01/);assert.match(html,/&lt;unsafe>/);assert.doesNotMatch(html,/<select|<unsafe>/);
  spools.find(s=>s.id===f.blue.id).name=f.blue.name;assert.equal(JSON.stringify(spools),snapshot);
});

test('iPad shows a pending-change action instead of Start, keeps the required roll visible and does not mutate by rendering',async t=>{
  const f=await setup(t);f.addJob();const q=f.production.queue(f.printer.id),p={...f.printer,telemetry:f.status};
  const before=JSON.stringify(q),dialog={addEventListener(){}};
  const ipad=createIpad({state:{connected:true,data:{printers:[p],queues:[q],inventory:f.inventory.overview(),library:[f.item]}},esc,dialog});
  const html=ipad.render([p]);assert.match(html,/operator-change-filament/);assert.match(html,/Cambio pendiente: Blanco01/);
  assert.equal(operatorState(p,q).canStart,false);assert.equal(plannedChanges(q.pending[0]).length,1);
  assert.match(plannedChangeSummary(q.pending[0],esc),/Blanco01/);assert.equal(JSON.stringify(q),before);assert.equal(f.transport.calls.length,0);
});

test('planned-change confirmation HTTP endpoint requires authentication and an exact job revision',async t=>{
  const f=await setup(t),j=f.addJob(),api=createApi({...f,token:'test-token'});
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>api.close(resolve)));
  const url=`http://127.0.0.1:${api.address().port}/api/printers/${f.printer.id}/queue/${j.id}/confirm-filament`;
  const asset=await fetch(`http://127.0.0.1:${api.address().port}/planned-filament.js`);
  assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  const headers={'content-type':'application/json','idempotency-key':'api-confirm-change'},body=JSON.stringify({changeId:j.materialChange.id,confirmed:true});
  assert.equal((await fetch(url,{method:'POST',headers,body})).status,401);
  headers.authorization='Bearer test-token';const response=await fetch(url,{method:'POST',headers,body});assert.equal(response.status,200);assert.equal((await response.json()).confirmed,true);
  assert.equal(f.transport.calls.length,0);
});

test('a pending change survives reopening storage and never rewrites queue order or balances',async t=>{
  const f=await setup(t),j=f.addJob(),saved=f.store.jobs(f.printer.id);
  const reopened=new Store(f.dir);
  try {
    assert.deepEqual(reopened.job(j.id).materialChange,j.materialChange);
    assert.deepEqual(reopened.jobs(f.printer.id),saved);
    assert.equal(reopened.materialPlan(j.id).issues[0].code,'FILAMENT_CHANGE_REQUIRED');
    assert.equal(reopened.reservedMg(f.white.id),35000);
    assert.equal(reopened.balanceMg(f.white.id),1000000);
    assert.equal(reopened.mount(f.printer.id,'external:254:0').spoolId,f.black.id);
  } finally {reopened.close();}
});

test('multimaterial changes reject impossible shared sources and shared bobinas',async t=>{
  const f=await setup(t),plate={filaments:[{id:1,type:'PLA',color:'#FFFFFF'},{id:2,type:'PLA',color:'#306BC8'}]};
  const input={enabled:true,filaments:[{filamentId:1,spoolId:f.white.id},{filamentId:2,spoolId:f.blue.id}]};
  const same={useAms:true,filamentMapping:[{amsId:0,slotId:0},{amsId:0,slotId:0}]};
  assert.throws(()=>f.inventory.normalizeChange(f.printer.id,plate,same,input),{code:'FILAMENT_CHANGE'});
  const separate={useAms:true,filamentMapping:[{amsId:0,slotId:0},{amsId:0,slotId:1}],nozzleMapping:[1,0]};
  assert.throws(()=>f.inventory.normalizeChange(f.printer.id,plate,separate,{enabled:true,filaments:[{filamentId:1,spoolId:f.white.id},{filamentId:2,spoolId:f.white.id}]}),{code:'FILAMENT_CHANGE'});
  assert.deepEqual(f.inventory.normalizeChange(f.printer.id,plate,separate,input).filaments.map(f=>f.sourceKey),['ams:0:0','ams:0:1']);
});

test('after collection the iPad asks for the planned change and requires a second confirmation before Start',async t=>{
  const f=await setup(t),first=f.addJob();confirm(f,first);
  const started=await f.production.dispatch(f.printer.id,{jobId:first.id,bedCleared:true,setupConfirmed:true},'start-for-collection');
  const next=f.addJob({...f.input,materialChange:{enabled:true,filaments:[{filamentId:1,spoolId:f.blue.id}]}},'next-for-collection');
  const packet=f.store.request(f.printer.id,started.attempt.startKey).packet.print;
  const status=fresh({slots:f.status.slots,status:'finished',progress:100,currentJob:{name:packet.subtask_name,file:packet.file}});
  f.transport.states.set(f.printer.id,status);f.transport.emit('telemetry',f.printer.id,status);
  let checked=false,click,requests=0;
  const form={reportValidity:()=>checked,addEventListener:(name,fn)=>{if(name==='click')click=fn;}};
  const error={textContent:''},dialog={open:false,innerHTML:'',classList:{remove(){},add(){}},addEventListener(){},
    showModal(){this.open=true;checked=false;},close(){this.open=false;},querySelector:s=>s==='form'?form:error,querySelectorAll:()=>[]};
  const state={connected:true,data:null};
  const refresh=async()=>{state.data={printers:[{...f.printer,telemetry:status}],queues:[f.production.queue(f.printer.id)]};};
  await refresh();
  const ipad=createIpad({state,esc,dialog,refresh,toast(){},mutate:async(route,input)=>{
    requests++;
    if(route.endsWith('/operator-collect'))return f.production.operatorCollect(f.printer.id,started.attempt.id,input,'collect-before-change');
    if(route.endsWith('/confirm-filament'))return f.inventory.confirmChange(f.printer.id,next.id,input,'confirm-after-collection');
    throw Error('Unexpected printer command');
  }});
  const choose=choice=>click({target:{closest:()=>({dataset:{choice}})}});
  ipad.action({dataset:{action:'operator-printed',id:f.printer.id}});
  checked=true;await choose('collect');
  assert.match(dialog.innerHTML,/Cambiar filamento/);assert.match(dialog.innerHTML,/Azul01/);
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.white.id);
  await choose('confirm-change');assert.equal(requests,1);
  checked=true;await choose('confirm-change');
  assert.equal(error.textContent,'');assert.match(dialog.innerHTML,/Iniciar siguiente/);
  assert.equal(f.store.mount(f.printer.id,'external:254:0').spoolId,f.blue.id);
  assert.equal(f.transport.calls.length,1);assert.equal(f.store.active(f.printer.id),undefined);
});
