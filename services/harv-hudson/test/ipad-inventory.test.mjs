import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { InventoryService } from '../src/inventory.mjs';
import { createApi } from '../src/api.mjs';
import { createIpadInventory,openSpoolForm } from '../public/ipad-inventory.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('simple iPad registration preserves dropdown colors, custom metadata and net grams through the inventory API',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  const server=createApi({...f,production,inventory,token:'ipad-inventory-test'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));inventory.close();production.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/ipad-inventory.js')).status,200);
  assert.equal((await fetch(base+'/api/spools',{method:'POST',body:'{}'})).status,401);
  const state={connected:true,data:{printers:[f.printer],inventory:inventory.overview()}},notifications=[];
  let submit,key=0;
  const screen=createIpadInventory({state,esc,openForm:(title,markup,callback)=>{submit=callback;},toast:text=>notifications.push(text),mutate:async(route,body)=>{
    const response=await fetch(base+route,{method:'POST',headers:{Authorization:'Bearer ipad-inventory-test','Content-Type':'application/json','Idempotency-Key':`ipad-register-${++key}`},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,201,result.message);return result;
  }});
  assert.match(screen.render(),/Agrega tu primer rollo/);screen.add();
  const values={material:'PLA',color:'#000000',brand:' Bambu Labs ',name:' Negro 01 ',remainingGrams:'1000',lowGrams:'100'};
  await submit(values);
  const first=inventory.overview().spools[0];
  assert.equal(first.name,'NegroB01');assert.equal(first.brand,'Bambu Labs');assert.equal(first.color,'#000000');
  assert.equal(first.remainingGrams,1000);assert.equal(first.balanceIsEstimate,true);assert.equal(first.mount,null);
  await assert.rejects(()=>submit({...values,remainingGrams:''}),/gramos/);
  await assert.rejects(()=>submit({...values,color:''}),/color/);
  await assert.rejects(()=>submit({...values,material:'other',customMaterial:''}),/material/);
  await assert.rejects(()=>submit({...values,brand:'other',customBrand:''}),/marca/);
  assert.equal(inventory.overview().spools.length,1);
  await submit({...values,material:'other',customMaterial:'PLA-CF',brand:'other',customBrand:'Marca propia',color:'other',customColor:'#343434',name:'',remainingGrams:'642.5',lowGrams:'75'});
  state.data.inventory=inventory.overview();
  const second=state.data.inventory.spools.find(s=>s.id!==first.id);
  assert.equal(second.material,'PLA-CF');assert.equal(second.color,'#343434');assert.equal(second.remainingGrams,642.5);
  assert.equal(second.brand,'Marca propia');assert.equal(second.name,'Color343434MP01');
  assert.equal(second.balanceIsEstimate,true);assert.equal(second.lowGrams,75);
  assert.equal(f.store.ledger(second.id).length,1);assert.equal(f.store.ledger(second.id)[0].amountMg,642500);
  assert.match(screen.render(),/NegroB01/);assert.match(screen.render(),/642.5/);
  assert.equal(notifications.length,2);assert.equal(f.transport.calls.length,0);
});

test('PC and iPad use the same simple fields, require an explicit color and reveal only the selected custom input',async()=>{
  const state={connected:true,data:{inventory:{spools:[{brand:'Marca propia',material:'ASA'},{brand:'<script>',material:'PET'}]}}};
  let desktop,tablet;
  openSpoolForm({state,esc,openForm:(...args)=>desktop=args});
  createIpadInventory({state,esc,openForm:(...args)=>tablet=args}).add();
  assert.equal(desktop[1],tablet[1]);
  const html=desktop[1];
  for(const value of ['PLA','PETG','ABS','TPU','PLA SILK','HVA','Elegoo','Mexico Makers','Bambu Labs','China','Negro','Blanco','Azul claro','Gris plata','Marca propia','ASA'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Origen del peso|name="basis"|name="weightMode"|<script>/);
  assert.match(html,/name="tareGrams" type="number" value="215"/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/name="color" required/);
  const elements=Object.fromEntries(['material','brand','color','customMaterial','customBrand','customColor'].map(name=>[name,{value:'',disabled:false}]));
  const panels=new Map();let change;
  const form={elements:{namedItem:name=>elements[name]},querySelector:selector=>{if(!panels.has(selector))panels.set(selector,{});return panels.get(selector);},addEventListener:(name,fn)=>{if(name==='change')change=fn;}};
  desktop[3].after(form);
  for(const name of ['customMaterial','customBrand','customColor'])assert.equal(elements[name].disabled,true);
  elements.brand.value='other';change();assert.equal(elements.customBrand.disabled,false);assert.equal(elements.customMaterial.disabled,true);
  elements.brand.value='Elegoo';change();assert.equal(elements.customBrand.disabled,true);
});

test('manual weight update needs only grams and preserves the existing ledger API contract',async()=>{
  const writes=[];let args;
  openSpoolForm({state:{connected:true},esc,spool:{id:'roll-001',name:'Bobina 001',material:'PLA',remainingGrams:1000},openForm:(...v)=>args=v,mutate:async(...v)=>writes.push(v),toast(){}});
  assert.doesNotMatch(args[1],/name="basis"|name="weightMode"|name="material"/);
  await args[2]({remainingGrams:'725.5'});
  assert.equal(writes[0][0],'/api/spools/roll-001/adjust');assert.equal(writes[0][1].remainingGrams,725.5);
  assert.equal(writes[0][1].basis,'estimated');assert.ok(writes[0][1].reason.length>=5);
  await assert.rejects(()=>args[2]({remainingGrams:'-1'}),/gramos/);
  assert.equal(writes.length,1);
});

test('iPad inventory escapes user labels, excludes archived rolls and prevents registration while disconnected',()=>{
  let opened=0;const messages=[];
  const state={connected:false,data:{printers:[],inventory:{spools:[{name:'<img onerror=alert(1)>',brand:'<script>',material:'PLA',remainingGrams:20,reservedGrams:30,availableGrams:-10,archived:false,alerts:[]},{name:'Archived roll',archived:true}]}}};
  const screen=createIpadInventory({state,esc,openForm:()=>opened++,toast:message=>messages.push(message)});
  const html=screen.render();
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script>|Archived roll/);
  assert.match(html,/-10 g/);assert.match(html,/operator-add-spool" disabled/);
  screen.add();assert.equal(opened,0);assert.equal(messages.length,1);
});
