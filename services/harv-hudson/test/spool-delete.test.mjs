import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fixture,writeArchive} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {createApi} from '../src/api.mjs';
import {openDeleteSpoolForm,spoolDeleteBlock,createIpadInventory} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roll={id:'roll-1',name:'Bobina <001>',material:'PLA',remainingGrams:1000,reservedGrams:0,archived:false,mount:null,alerts:[]};
const snapshot=()=>({inventory:{spools:[structuredClone(roll)]},queues:[],printers:[]});

test('confirmed deletion uses the existing API, keeps history and leaves queued jobs, other spools and printer commands untouched',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  const server=createApi({...f,production,inventory,token:'spool-delete-test'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));inventory.close();production.close();});
  const base=`http://127.0.0.1:${server.address().port}`,body={name:'Bobina 001',material:'PLA',color:'#FFFFFF',remainingGrams:1000,basis:'estimated'};
  const loaded=inventory.create(body,'loaded-spool-fixture'),unused=inventory.create({...body,name:'Spare <002>'},'unused-spool-fixture');
  inventory.bind(f.printer.id,{spoolId:loaded.id,source:'ams',amsId:0,slotId:0,confirmed:true},'mount-spool-fixture');
  const file=path.join(f.dir,'test-only.gcode.3mf');await writeArchive(file);const item=await production.importFile(file,'Test only');
  production.add(f.printer.id,{libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:true,amsMapping:[0]}},'queue-spool-fixture');
  const before={jobs:f.store.jobs(f.printer.id),mounts:f.store.mounts(),loaded:inventory.view(loaded.id),history:f.store.ledger(unused.id)};
  const readSnapshot=async()=>{const response=await fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer spool-delete-test'}});assert.equal(response.status,200);return response.json();};
  const state={connected:true,data:await readSnapshot()},writes=[],notifications=[];let form;
  const mutate=async(route,payload)=>{
    writes.push({route,payload});
    const response=await fetch(base+route,{method:'POST',headers:{Authorization:'Bearer spool-delete-test','Content-Type':'application/json','Idempotency-Key':'confirmed-spool-delete'},body:JSON.stringify(payload)});
    const result=await response.json();assert.equal(response.status,200,result.message);return result;
  };
  await openDeleteSpoolForm({id:unused.id,state,esc,openForm:(...args)=>form=args,mutate,toast:m=>notifications.push(m),readSnapshot});
  assert.equal(writes.length,0);assert.equal(inventory.view(unused.id).archived,false);
  assert.match(form[1],/Spare &lt;002&gt;/);assert.equal(form[3].submit,'Eliminar bobina');
  await form[2]();assert.equal(writes.length,1);assert.deepEqual(writes[0],{route:`/api/spools/${unused.id}/edit`,payload:{archived:true}});
  assert.equal(inventory.view(unused.id).archived,true);assert.equal(inventory.view(unused.id).remainingGrams,1000);
  assert.deepEqual(f.store.ledger(unused.id),before.history);assert.deepEqual(f.store.jobs(f.printer.id),before.jobs);
  assert.deepEqual(f.store.mounts(),before.mounts);assert.deepEqual(inventory.view(loaded.id),before.loaded);assert.equal(f.transport.calls.length,0);
  state.data=await readSnapshot();assert.doesNotMatch(createIpadInventory({state,esc}).render(),/Spare/);
  // A retry of the same HTTP write is idempotent, and a loaded spool remains protected by the server.
  await mutate(writes[0].route,{archived:true});assert.deepEqual(f.store.ledger(unused.id),before.history);
  assert.throws(()=>inventory.edit(loaded.id,{archived:true},'delete-loaded-fixture'),{code:'MOUNTED'});
  assert.equal(notifications.length,1);
});

test('deletion explains loaded, reserved and planned spools, and rechecks changes made while the confirmation is open',async()=>{
  const variants=[
    d=>{d.inventory.spools[0].mount={printerId:'p'};},
    d=>{d.inventory.spools[0].reservedGrams=1;},
    d=>{d.queues=[{pending:[{materialChange:{enabled:true,filaments:[{spoolId:roll.id}]}}]}];},
    d=>{d.queues=[{active:{attempt:{allocations:[{spoolId:roll.id}]}}}];}
  ];
  for(const change of variants){
    let data=snapshot(),form,writes=0;
    const args={id:roll.id,state:{connected:true},esc,readSnapshot:async()=>data,openForm:(...v)=>form=v,mutate:async()=>writes++,toast(){}};
    await openDeleteSpoolForm(args);assert.equal(form[3].hideSubmit,false);
    change(data);assert.ok(spoolDeleteBlock(data,roll.id));await assert.rejects(form[2]);assert.equal(writes,0);
    await openDeleteSpoolForm(args);assert.equal(form[3].hideSubmit,true);assert.equal(writes,0);
  }
});

test('confirmation handles removed spools, lost connections, API failures and both languages without a false success',async()=>{
  const data=snapshot();let form,writes=0,success=0;
  const args={id:roll.id,state:{connected:true},esc,readSnapshot:async()=>data,openForm:(...v)=>form=v,mutate:async()=>{writes++;throw new Error('Disconnected');},toast:(m,error)=>{if(!error)success++;}};
  for(const lang of ['es','en']){
    try{
      setLanguage(lang,{reload:false});await openDeleteSpoolForm(args);
      assert.equal(form[0],lang==='en'?'Delete spool':'Eliminar bobina');
      assert.match(form[1],lang==='en'?/history and filament usage will be kept/:/historial y sus consumos se conservarán/);
      assert.match(form[1],/Bobina &lt;001&gt;/);assert.doesNotMatch(form[1],/<001>/);
      await assert.rejects(form[2],/Disconnected/);assert.equal(success,0);
    }finally{setLanguage('es',{reload:false});}
  }
  data.inventory.spools[0].archived=true;await assert.rejects(form[2],/ya no está/);assert.equal(writes,2);
  let opened=false;await openDeleteSpoolForm({...args,openForm:()=>opened=true});assert.equal(opened,false);
  await openDeleteSpoolForm({...args,state:{connected:false},readSnapshot:()=>{throw new Error('must not read');}});assert.equal(opened,false);
});
