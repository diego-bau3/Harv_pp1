import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fixture,fresh,writeArchive} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {createApi} from '../src/api.mjs';
import {assignmentPositions,assignmentSpoolBlock,prepareFilamentAssignment,confirmFilamentAssignment,openAssignFilamentForm} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';

const external={source:'external',amsId:254,slotId:0};
const printer={id:'p',model:'P1S',name:'P1S',telemetry:fresh({slots:[external]})};
const spool={id:'s',name:'BlancoM01',material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',remainingGrams:500,mount:null};
const data=()=>({printers:[structuredClone(printer)],queues:[{printerId:'p',active:null,pending:[]}],inventory:{spools:[structuredClone(spool)]}});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('assignment shows real AMS groups with four slots, external inputs separately, and no invented AMS on P1S',()=>{
  assert.deepEqual(assignmentPositions(printer).map(s=>s.key),['external:254:0']);
  const p={...printer,model:'X2D',telemetry:fresh({slots:[{source:'ams',amsId:0,slotId:0},external,{...external,amsId:255}]})};
  assert.deepEqual(assignmentPositions(p).map(s=>s.key),['ams:0:0','ams:0:1','ams:0:2','ams:0:3','external:254:0','external:255:0']);
  p.telemetry.slots.push({source:'ams',amsId:1,slotId:3},{source:'ams',amsId:128,slotId:0});
  assert.equal(assignmentPositions(p).filter(s=>s.source==='ams').length,9);
  assert.equal(assignmentPositions({...p,unlinked:true}).length,0);
});

test('confirmation rechecks source, destination, connection and active work before any write',async()=>{
  const initial=data(),proposal=prepareFilamentAssignment(initial,'s','p','external:254:0');
  const changedSpool={...spool,id:'other',mount:{...external,printerId:'p',confirmedAt:'later'}};
  const cases=[
    d=>{d.printers[0].telemetry.fresh=false;},
    d=>{d.printers[0].telemetry.status='printing';},
    d=>{d.queues[0].active={attempt:{allocations:[]}};},
    d=>{d.inventory.spools[0].archived=true;},
    d=>{d.inventory.spools.push(changedSpool);},
    d=>{d.printers.push({...printer,id:'other'});d.inventory.spools[0].mount={...external,printerId:'other',confirmedAt:'later'};}
  ];
  let writes=0;const mutate=async()=>writes++;
  for(const alter of cases){const current=data();alter(current);await assert.rejects(confirmFilamentAssignment({state:{connected:true},proposal,confirmed:true,readSnapshot:async()=>current,mutate}));}
  await assert.rejects(confirmFilamentAssignment({state:{connected:true},proposal,confirmed:false,readSnapshot:async()=>initial,mutate}),/físico/);
  await assert.rejects(confirmFilamentAssignment({state:{connected:false},proposal,confirmed:true,readSnapshot:async()=>initial,mutate}),/conectarse/);
  await assert.rejects(confirmFilamentAssignment({state:{connected:true},proposal,confirmed:true,readSnapshot:async()=>{throw Error('network');},mutate}),/network/);
  assert.equal(writes,0);
  const unreviewed={...spool,remainingGrams:0,stockUncertain:true};
  assert.equal(assignmentSpoolBlock(initial,unreviewed), '');
});

test('existing mount API moves a spool once, releases the replaced roll and preserves balances, labels and queue order',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  f.transport.states.set(f.printer.id,fresh({slots:[external]}));
  const p2=await f.service.register({name:'A1 test',model:'A1',serial:'ASSIGNTEST456',ipAddress:'192.168.1.11',nozzleDiameters:[0.4],accessCode:'test-code'});
  const batch=inventory.createBatch({material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',quantity:2,remainingGrams:500,basis:'estimated'},'assign-seed-rolls').spools;
  inventory.bind(f.printer.id,{...external,spoolId:batch[0].id,confirmed:true},'assign-initial-p1');
  inventory.bind(p2.id,{source:'ams',amsId:0,slotId:0,spoolId:batch[1].id,confirmed:true},'assign-initial-a1');
  const archive=path.join(f.dir,'assign-test.3mf');await writeArchive(archive);const file=await production.importFile(archive,'Queue retained');
  production.add(f.printer.id,{libraryId:file.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:false}},'assign-pending-jobs');
  const jobsBefore=f.store.jobs(f.printer.id).map(j=>({id:j.id,state:j.state,order:j.order,settings:j.settings}));
  const ledgerBefore=batch.map(s=>f.store.ledger(s.id));
  const server=createApi({...f,production,inventory,token:'assign-test-token'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer assign-test-token'};
  const readSnapshot=async()=>{const r=await fetch(base+'/api/dashboard',{headers});assert.equal(r.status,200);return r.json();};
  const proposal=prepareFilamentAssignment(await readSnapshot(),batch[0].id,p2.id,'ams:0:0');
  let sent;
  await confirmFilamentAssignment({state:{connected:true},proposal,confirmed:true,readSnapshot,mutate:async(route,body)=>{
    sent={route,body};const response=await fetch(base+route,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'assign-physical-change'},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,200,result.message);return result;
  }});
  assert.deepEqual(sent.body,{spoolId:batch[0].id,source:'ams',amsId:0,slotId:0,confirmed:true});
  assert.equal(inventory.view(batch[0].id).mount.printerId,p2.id);assert.equal(inventory.view(batch[1].id).mount,null);
  assert.equal(f.store.mounts().length,1);assert.deepEqual(batch.map(s=>f.store.ledger(s.id)),ledgerBefore);
  assert.equal(inventory.view(batch[0].id).name,batch[0].name);assert.equal(inventory.view(batch[0].id).remainingGrams,500);
  assert.deepEqual(f.store.jobs(f.printer.id).map(j=>({id:j.id,state:j.state,order:j.order,settings:j.settings})),jobsBefore);
  assert.equal(f.transport.calls.length,0);
});

test('PC and iPad open the same bilingual board, escape inventory text and never write before confirmation',async()=>{
  for(const lang of ['es','en']){
    setLanguage(lang,{reload:false});
    try{
      const snapshot=data();snapshot.inventory.spools[0].name='<script>bad</script>';let pc,ipad,writes=0;
      const options={state:{connected:true},esc,mutate:async()=>writes++,toast(){},readSnapshot:async()=>snapshot};
      await openAssignFilamentForm({...options,openForm:(...args)=>pc=args});
      await openAssignFilamentForm({...options,ipad:true,openForm:(...args)=>ipad=args});
      assert.equal(pc[1],ipad[1]);assert.equal(pc[0],lang==='en'?'Assign filament':'Asignar filamento');
      assert.match(pc[1],/&lt;script&gt;bad/);assert.doesNotMatch(pc[1],/<script>/);
      assert.match(pc[1],/name="confirmed" required disabled/);assert.equal(writes,0);
    }finally{setLanguage('es',{reload:false});}
  }
});
