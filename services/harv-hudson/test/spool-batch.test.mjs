import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {Store} from '../src/store.mjs';
import {createApi} from '../src/api.mjs';
import {planSpoolLabels} from '../public/spool-labels.js';
import {openSpoolForm,spoolBatchPayload} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';
const input={material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',quantity:4,remainingGrams:1000,basis:'estimated'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function setup(t){const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});t.after(()=>{inventory.close();production.close();});return {...f,production,inventory};}
test('full, partial and empty rolls share a permanent sequence across materials, archival, weight changes and restarts',async t=>{
  const f=await setup(t),i=f.inventory;
  const first=i.createBatch(input,'batch-first');
  assert.deepEqual(first.spools.map(s=>s.name),['BlancoM01','BlancoM02','BlancoM03','BlancoM04']);
  assert.equal(new Set(first.spools.map(s=>s.id)).size,4);
  for(const s of first.spools){assert.equal(s.remainingGrams,1000);assert.equal(s.mount,null);assert.equal(f.store.ledger(s.id).length,1);}
  const empty=i.createBatch({...input,remainingGrams:0,quantity:1},'empty-first').spools[0];assert.equal(empty.name,'BlancoM05');assert.equal(empty.remainingGrams,0);
  i.adjust(first.spools[0].id,{remainingGrams:0,basis:'estimated',reason:'Bobina agotada'},'empty-adjust');
  assert.equal(i.view(first.spools[0].id).name,'BlancoM01');
  i.edit(empty.id,{archived:true},'archive-empty');
  assert.throws(()=>i.edit(empty.id,{name:'Otro nombre'},'rename-label'),/permanente/);
  const next=i.createBatch({...input,quantity:1,material:'PETG',remainingGrams:327.5},'partial-next').spools[0];assert.equal(next.name,'BlancoM06');
  assert.equal(next.remainingGrams,327.5);
  i.close();f.production.close();
  const store=new Store(f.dir),p=new ProductionService({...f,store}),inv=new InventoryService({store,production:p});
  try{assert.equal(inv.createBatch({...input,quantity:1},'after-restart').spools[0].name,'BlancoM07');assert.equal(inv.createBatch(input,'batch-first').spools.length,4);assert.equal(store.spools().length,7);}
  finally{inv.close();p.close();store.close();}
  assert.equal(f.transport.calls.length,0);
});
test('old labels including archived, empty, spaced and renamed records reserve their numbers',async t=>{
  const f=await setup(t),i=f.inventory;
  const old=i.create({...input,name:'Blanco M 08',remainingGrams:0},'old-label');
  i.edit(old.id,{name:'Etiqueta anterior',archived:true},'rename-archive');
  assert.equal(i.createBatch({...input,quantity:1},'after-legacy').spools[0].name,'BlancoM09');
  const record=f.store.spools().find(s=>s.name==='BlancoM09');
  // A maintenance removal cannot reset a sequence already committed to the registry.
  f.store.db.prepare('DELETE FROM spools WHERE id=?').run(record.id);
  assert.equal(i.createBatch({...input,quantity:1},'after-removal').spools[0].name,'BlancoM10');
});
test('a failed batch rolls back every spool, movement, code and receipt; retry creates it exactly once',async t=>{
  const f=await setup(t),i=f.inventory,save=f.store.saveSpool;let n=0;
  f.store.saveSpool=function(s){if(++n===2)throw Error('Simulated disk failure');return save.call(this,s);};
  assert.throws(()=>i.createBatch(input,'retry-disk-failure'),/disk failure/);
  assert.equal(f.store.spools().length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM material_ledger').get().n,0);
  f.store.saveSpool=save;
  const a=i.createBatch(input,'retry-disk-failure'),b=i.createBatch(input,'retry-disk-failure');
  assert.deepEqual(a,b);assert.equal(f.store.spools().length,4);assert.equal(a.spools[0].name,'BlancoM01');
  assert.throws(()=>i.createBatch({...input,quantity:5},'retry-disk-failure'),/otra solicitud/);
});
test('batch API authenticates, validates, serializes clients and never changes production queues or sends printer commands',async t=>{
  const f=await setup(t),server=createApi({...f,token:'batch-test-token'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body,key,auth=true)=>fetch(base+'/api/spools/batch',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...auth?{Authorization:'Bearer batch-test-token'}:{}},body:JSON.stringify(body)});
  const snapshot=()=>JSON.stringify(['jobs','attempts','active_runs','collections','material_plans','material_reservations','operations'].map(table=>f.store.db.prepare('SELECT * FROM '+table).all()));
  const before=snapshot();
  assert.equal((await post(input,'no-session',false)).status,401);
  for(const body of [{...input,quantity:0},{...input,quantity:1.5},{...input,quantity:101},{...input,remainingGrams:-1},{...input,remainingGrams:'0'},{...input,color:'white'},{...input,brand:''}])assert.equal((await post(body,'invalid-test')).status,400);
  assert.equal(f.store.spools().length,0);
  const responses=await Promise.all([post(input,'client-one'),post(input,'client-two'),post(input,'client-one')]);
  for(const r of responses)assert.equal(r.status,201);
  const [one,two,repeat]=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(one,repeat);assert.equal(new Set([...one.spools,...two.spools].map(s=>s.name)).size,8);
  assert.equal(snapshot(),before);assert.equal(f.transport.calls.length,0);
  assert.equal((await fetch(base+'/spool-labels.js')).status,200);
});
test('custom brands never collide; Bambu aliases, color codes and physical names stay independent of UI language',()=>{
  assert.equal(planSpoolLabels({spools:[{name:'Blanco02',brand:'Mexico Makers',color:'#FFFFFF',archived:true}]},{...input,quantity:1}).labels[0].name,'BlancoM03');
  const inventory={spools:[{name:'BlancoB09',brand:'Bambu Lab',archived:true}]};
  assert.equal(planSpoolLabels(inventory,{...input,brand:'Bambu Labs',quantity:1}).labels[0].name,'BlancoB10');
  const a=planSpoolLabels({}, {...input,brand:'Marca Propia',quantity:1});
  const b=planSpoolLabels({labelRegistry:a.registry},{...input,brand:'Mundo Plastico',quantity:1});
  assert.notEqual(a.brandCode,b.brandCode);
  assert.equal(planSpoolLabels({labelRegistry:b.registry},{...input,brand:'marca propia',quantity:1}).labels[0].name,'BlancoMP02');
  const plain=JSON.stringify(inventory);planSpoolLabels(inventory,input);assert.equal(JSON.stringify(inventory),plain);
  try{setLanguage('en',{reload:false});assert.equal(planSpoolLabels({},input).labels[0].name,'BlancoM01');}finally{setLanguage('es',{reload:false});}
});
test('PC/iPad batch form previews real sequence, supports zero grams and shows actual server labels on success',async()=>{
  const state={connected:true,data:{inventory:{spools:[{name:'BlancoM04',brand:'Mexico Makers',archived:true,remainingGrams:0}]}}};
  for(const lang of ['es','en']){
    setLanguage(lang,{reload:false});const writes=[];let args;
    openSpoolForm({state,esc,openForm:(...v)=>args=v,mutate:async(route,body)=>{writes.push({route,body});return {spools:[{name:'BlancoM06',material:'PLA',remainingGrams:0}]};},toast(){}});
    assert.match(args[1],/name="quantity"/);assert.match(args[1],/value="empty"/);assert.doesNotMatch(args[1],/name="name"|name="basis"/);
    assert.ok(args[1].includes(lang==='en'?'Empty':'Vacías'));
    const v={material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',quantity:'2',fillState:'empty',remainingGrams:'1000'};
    assert.equal(spoolBatchPayload(v).remainingGrams,0);
    const result=await args[2](v);assert.equal(writes[0].route,'/api/spools/batch');assert.equal(writes[0].body.quantity,2);
    args[3].onSuccess(result);assert.match(args[1],/BlancoM06/);
    assert.ok(args[1].includes(lang==='en'?'Write one code':'Escribe un código'));
  }
  setLanguage('es',{reload:false});
});

test('scale weight subtracts the standard or edited tare once per spool, while full and empty weights stay net',async t=>{
  const f=await setup(t),server=createApi({...f,token:'tare-test'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const cases=[
    [{fillState:'partial',grossGrams:'715'},500],
    [{fillState:'partial',grossGrams:'715.125',tareGrams:'200.025'},515.1],
    [{fillState:'partial',grossGrams:'215',tareGrams:'215'},0],
    [{fillState:'full',remainingGrams:'1000',tareGrams:'215',grossGrams:'715'},1000],
    [{fillState:'empty',remainingGrams:'1000',tareGrams:'215',grossGrams:'715'},0]
  ];
  let key=0;
  for(const [values,net] of cases){
    const payload=spoolBatchPayload({...input,quantity:2,...values});
    if(values.fillState==='partial'){assert.equal(payload.remainingGrams,undefined);assert.equal(payload.tareGrams,Number(values.tareGrams??215));}
    const response=await fetch(base+'/api/spools/batch',{method:'POST',headers:{Authorization:'Bearer tare-test','Content-Type':'application/json','Idempotency-Key':`tare-case-${++key}`},body:JSON.stringify(payload)});
    const result=await response.json();assert.equal(response.status,201,result.message);
    for(const spool of result.spools){assert.equal(spool.remainingGrams,net);assert.equal(f.store.ledger(spool.id)[0].amountMg,Math.round(net*1000));}
  }
  for(const values of [{grossGrams:'214'}, {grossGrams:''}, {grossGrams:'abc'}, {grossGrams:'715',tareGrams:''}, {grossGrams:'715',tareGrams:'-1'}, {grossGrams:'715',tareGrams:'800'}])
    assert.throws(()=>spoolBatchPayload({...input,fillState:'partial',...values}),/gramos|bobina vacía/);
  assert.equal(f.transport.calls.length,0);
});
