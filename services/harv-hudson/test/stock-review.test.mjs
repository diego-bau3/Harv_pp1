import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fixture,fresh,writeArchive } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { InventoryService } from '../src/inventory.mjs';
import { filamentPicker,filamentChoices,openSpoolForm,createIpadInventory } from '../public/ipad-inventory.js';
import { filamentAlert,operatorState } from '../public/ipad-state.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const spool={id:'white',name:'Blanco',material:'PLA',color:'#FFFFFF',remainingGrams:799.65,stockUncertain:true,
  uncertaintyReason:'Impresión fuera del intento de Hudson; consumo sin contabilizar.',mount:{printerId:'p',source:'external',amsId:254,slotId:0}};
const printer={id:'p',name:'P1S',model:'P1S',telemetry:fresh({slots:[{source:'external',amsId:254,slotId:0,material:'PLA',color:'BBBBBBFF',empty:false}]})};
const filament={id:1,type:'PLA',color:'#FFFFFF',grams:71.1};

test('external consumption is labeled as stock review, not incompatible color or trusted remaining grams',()=>{
  const html=filamentPicker({printer,spools:[spool],filament,esc});
  assert.match(html,/Hubo impresiones fuera de Hudson/);
  assert.match(html,/799.7 g registrados · por revisar/);
  assert.match(html,/data-action="weigh" data-id="white"/);
  assert.doesNotMatch(html,/No hay una bobina cargada compatible|Color distinto|799.7 g restantes/);
  assert.equal(filamentChoices(printer,[spool],filament)[0].usable,false);
  const state={connected:true,data:{printers:[printer],inventory:{spools:[spool]}}};
  const ui=createIpadInventory({state,esc});
  assert.match(ui.render(),/operator-weigh-spool/);
  const plan={state:'blocked',issues:[{code:'STOCK_REVIEW',loaded:{spoolId:'white',name:'Blanco'}}]};
  assert.match(filamentAlert(plan,esc),/Actualizar saldo de la bobina/);
  const view=operatorState(printer,{pending:[{id:'job',materialPlan:plan}]});
  assert.equal(view.canStart,false);assert.match(view.hint,/saldo/);
  const mismatch=filamentPicker({printer,spools:[{...spool,stockUncertain:false,color:'#000000'}],filament,esc});
  assert.match(mismatch,/Color distinto/);assert.match(mismatch,/No hay una bobina cargada compatible/);
});

test('review requires explicit new grams and confirmation, then rechecks a printer that started while the form was open',async()=>{
  const s=structuredClone(spool),p=structuredClone(printer),state={connected:true,data:{printers:[p],queues:[],inventory:{spools:[s]}}};
  let form,writes=0;
  openSpoolForm({state,esc,spool:s,openForm:(...args)=>form=args,mutate:()=>writes++,toast(){}});
  assert.match(form[1],/name="remainingGrams"[^>]*value=""/);
  assert.match(form[1],/name="stockReviewed" required/);
  await assert.rejects(()=>form[2]({remainingGrams:'700'}),/Confirma/);
  await assert.rejects(()=>form[2]({remainingGrams:'',stockReviewed:'on'}),/gramos/);
  p.telemetry.status='printing';
  await assert.rejects(()=>form[2]({remainingGrams:'700',stockReviewed:'on'}),/detenida/);
  assert.equal(writes,0);
  p.telemetry.status='idle';p.telemetry.fresh=false;
  await assert.rejects(()=>form[2]({remainingGrams:'700',stockReviewed:'on'}),/conectada/);
  assert.equal(writes,0);
});

test('external print recovery requires collection first and reconciles stock without altering queue, mounts or settled consumption',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const file=path.join(f.dir,'plate.gcode.3mf');await writeArchive(file);f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'30 grams');
  const s=inventory.create({name:'Blanco',material:'PLA',color:'#FFFFFF',remainingGrams:1000,basis:'measured'},'stock-create');
  const id=f.printer.id;
  inventory.bind(id,{spoolId:s.id,source:'ams',amsId:0,slotId:0,confirmed:true},'stock-bind');
  const jobs=production.add(id,{libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:true,amsMapping:[0]}},'stock-queue').jobs;
  const a=(await production.dispatch(id,{jobId:jobs[0].id,bedCleared:true,setupConfirmed:true},'stock-start')).attempt;
  const report=status=>{f.transport.states.set(id,status);f.transport.emit('telemetry',id,status);};
  const op=f.store.request(id,a.startKey);
  report(fresh({status:'finished',progress:100,currentJob:{name:op.packet.print.subtask_name,file:op.packet.print.file}}));
  report(fresh({status:'printing',progress:20,currentJob:{name:'Direct from Studio',file:'external.gcode.3mf'}}));
  report(fresh());
  assert.equal(inventory.view(s.id).remainingGrams,970);assert.equal(inventory.view(s.id).stockUncertain,true);
  assert.equal(production.queue(id).active.attempt.collectionConflict,true);
  const state={connected:true,data:null};
  const refresh=()=>{state.data={printers:[{...f.printer,telemetry:f.transport.status(id)}],queues:[production.queue(id)],inventory:inventory.overview()};};
  refresh();let form;
  const open=ipad=>openSpoolForm({state,esc,spool:inventory.view(s.id),ipad,openForm:(...args)=>form=args,
    mutate:async(route,body)=>{assert.equal(route,`/api/spools/${s.id}/adjust`);return inventory.adjust(s.id,body,'stock-adjust');},toast(){}});
  open(false);assert.equal(form[3].hideSubmit,true);assert.match(form[1],/data-action="collect"/);
  open(true);assert.equal(form[3].hideSubmit,true);assert.match(form[1],/Pide al encargado/);assert.doesNotMatch(form[1],/data-action="collect"|name="remainingGrams"/);
  assert.throws(()=>inventory.adjust(s.id,{remainingGrams:920,basis:'estimated',reason:'External consumption'},'too-soon'),{code:'SPOOL_IN_USE'});
  production.collect(id,a.id,{good:1,rejected:0,outcome:'finished',bedCleared:true,printerChecked:true,note:'Placa retirada y comprobada.'},'stock-collect');
  refresh();const jobsBefore=JSON.stringify(f.store.jobs(id)),mountsBefore=JSON.stringify(f.store.mounts()),usageBefore=JSON.stringify(f.store.usage(a.id)),calls=f.transport.calls.length;
  open(true);await form[2]({remainingGrams:'920',stockReviewed:'on'});
  assert.equal(inventory.view(s.id).remainingGrams,920);assert.equal(inventory.view(s.id).stockUncertain,false);
  assert.equal(inventory.view(s.id).basis,'estimated');assert.equal(production.queue(id).pending[0].materialPlan.state,'ready');
  assert.equal(f.store.ledger(s.id)[0].amountMg,-50000);
  await form[2]({remainingGrams:'920',stockReviewed:'on'});
  assert.equal(inventory.view(s.id).remainingGrams,920);assert.equal(f.store.ledger(s.id).length,3);
  assert.equal(JSON.stringify(f.store.jobs(id)),jobsBefore);assert.equal(JSON.stringify(f.store.mounts()),mountsBefore);
  assert.equal(JSON.stringify(f.store.usage(a.id)),usageBefore);assert.equal(f.transport.calls.length,calls);
});
