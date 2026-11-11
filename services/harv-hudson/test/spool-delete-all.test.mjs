import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {createApi} from '../src/api.mjs';
import {openDeleteAllSpoolsForm} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const spool=(id,patch={})=>({id,name:id,material:'PLA',remainingGrams:1000,reservedGrams:0,archived:false,mount:null,...patch});

test('bulk deletion archives available spools through the API while keeping loaded spools, history and printer state',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  const server=createApi({...f,production,inventory,token:'bulk-spool-test'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));inventory.close();production.close();});
  const base=`http://127.0.0.1:${server.address().port}`,input={material:'PLA',remainingGrams:1000,basis:'estimated'};
  const rolls=['Loaded','Available one','Available two'].map((name,i)=>inventory.create({...input,name},`create-bulk-spool-${i}`));
  inventory.bind(f.printer.id,{spoolId:rolls[0].id,source:'ams',amsId:0,slotId:0,confirmed:true},'mount-bulk-spool');
  const before={mounts:f.store.mounts(),jobs:f.store.jobs(f.printer.id),ledgers:rolls.map(s=>f.store.ledger(s.id)),loaded:inventory.view(rolls[0].id)};
  const readSnapshot=async()=>{const r=await fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer bulk-spool-test'}});assert.equal(r.status,200);return r.json();};
  let form,writes=0;const messages=[];
  await openDeleteAllSpoolsForm({state:{connected:true,query:'Loaded',filter:'attention'},esc,readSnapshot,openForm:(...v)=>form=v,toast:m=>messages.push(m),mutate:async(route,body)=>{
    writes++;const r=await fetch(base+route,{method:'POST',headers:{Authorization:'Bearer bulk-spool-test','Content-Type':'application/json','Idempotency-Key':`bulk-delete-${writes}`},body:JSON.stringify(body)});
    const result=await r.json();assert.equal(r.status,200,result.message);return result;
  }});
  assert.equal(writes,0);assert.match(form[1],/Se eliminarán: 2/);assert.match(form[1],/Se conservarán por estar en uso: 1/);
  await assert.rejects(()=>form[2]({}),/Confirma/);assert.equal(writes,0);
  await form[2]({confirmDelete:'on'});assert.equal(writes,2);
  assert.deepEqual(rolls.map(s=>inventory.view(s.id).archived),[false,true,true]);
  assert.deepEqual(rolls.map(s=>f.store.ledger(s.id)),before.ledgers);assert.deepEqual(inventory.view(rolls[0].id),before.loaded);
  assert.deepEqual(f.store.mounts(),before.mounts);assert.deepEqual(f.store.jobs(f.printer.id),before.jobs);assert.equal(f.transport.calls.length,0);
  assert.match(messages[0],/2/);
});

test('bulk confirmation freezes reviewed IDs, reports partial failure and retries only remaining spools',async()=>{
  const data={inventory:{spools:[spool('one'),spool('two'),spool('three')]},queues:[]};
  let form,fail=true;const writes=[],messages=[];
  await openDeleteAllSpoolsForm({state:{connected:true},esc,readSnapshot:async()=>structuredClone(data),openForm:(...v)=>form=v,toast:m=>messages.push(m),mutate:async route=>{
    const id=route.split('/')[3];writes.push(id);if(id==='two'&&fail)throw new Error('Connection lost');
    data.inventory.spools.find(s=>s.id===id).archived=true;
  }});
  data.inventory.spools.push(spool('newly-added'));
  await assert.rejects(()=>form[2]({confirmDelete:'on'}),/Eliminaciones confirmadas: 1\. Connection lost/);
  assert.deepEqual(writes,['one','two']);assert.equal(messages.length,0);
  fail=false;await form[2]({confirmDelete:'on'});
  assert.deepEqual(writes,['one','two','two','three']);assert.equal(data.inventory.spools[3].archived,false);
  assert.match(messages[0],/3/);
});

test('bulk deletion rechecks newly loaded or queued spools before each write and stops without deleting them',async()=>{
  for(const change of [data=>{data.inventory.spools[0].mount={printerId:'p'};},data=>{data.queues=[{pending:[{materialChange:{enabled:true,filaments:[{spoolId:'one'}]}}]}];}]){
    const data={inventory:{spools:[spool('one'),spool('two')]},queues:[]};let form,writes=0;
    await openDeleteAllSpoolsForm({state:{connected:true},esc,readSnapshot:async()=>structuredClone(data),openForm:(...v)=>form=v,toast(){},mutate:async()=>writes++});
    change(data);await assert.rejects(()=>form[2]({confirmDelete:'on'}),/Eliminaciones confirmadas: 0/);assert.equal(writes,0);
  }
});

test('empty, unavailable and disconnected inventories never submit; dialogs translate and escape names',async()=>{
  for(const lang of ['es','en']){
    try{
      setLanguage(lang,{reload:false});
      const data={inventory:{spools:[spool('<script>',{mount:{printerId:'p'}})]},queues:[]};let form,reads=0;
      const args={state:{connected:true},esc,readSnapshot:async()=>{reads++;return data;},openForm:(...v)=>form=v,toast(){},mutate:async()=>assert.fail('No mutation expected')};
      await openDeleteAllSpoolsForm(args);assert.equal(form[0],lang==='en'?'Delete all':'Eliminar todas');
      assert.equal(form[3].hideSubmit,true);assert.match(form[1],/&lt;script&gt;/);assert.doesNotMatch(form[1],/<script>/);
      assert.match(form[1],lang==='en'?/Kept because they are in use: 1/:/Se conservarán por estar en uso: 1/);
      await assert.rejects(()=>form[2]({confirmDelete:'on'}));
      data.inventory.spools=[];await openDeleteAllSpoolsForm(args);assert.equal(form[3].hideSubmit,true);
      assert.doesNotMatch(form[1],/name="confirmDelete"/);
      await openDeleteAllSpoolsForm({...args,state:{connected:false},openForm:()=>assert.fail('No dialog expected')});assert.equal(reads,2);
    }finally{setLanguage('es',{reload:false});}
  }
});
