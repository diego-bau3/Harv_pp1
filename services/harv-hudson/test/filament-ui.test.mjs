import {t as uiText,ht,locale,translateMessage,languageSelector,setLanguage} from '../public/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {filamentPositions,filamentChoices,filamentPicker,filamentChangeReason,createIpadInventory} from '../public/ipad-inventory.js';
import {fixture,fresh,writeArchive} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slot=(slotId,patch={})=>({source:'ams',amsId:0,slotId,material:'PLA',color:'000000FF',empty:false,...patch});
const printer=(patch={})=>({id:'p',name:'A1',model:'A1',telemetry:{fresh:true,status:'idle',slots:[slot(0),slot(1),slot(2)]},...patch});
const spool=(id,slotId,patch={})=>({id,name:id,material:'PLA',brand:'Test',color:'#000000',remainingGrams:800,archived:false,mount:slotId===null?null:{printerId:'p',source:'ams',amsId:0,slotId},...patch});
const filament={id:1,type:'PLA',color:'#000000',grams:30};

test('physical positions preserve real AMS and both external identities, without inventing AMS on unlinked printers',()=>{
  const p=printer({model:'X2D'});p.telemetry.slots=[slot(0),slot(0,{source:'external',amsId:254}),slot(0,{source:'external',amsId:255}),slot(0,{amsId:128})];
  const rolls=[spool('ams',0),spool('ext2',0,{mount:{printerId:'p',source:'external',amsId:255,slotId:0}})];
  const before=JSON.stringify({p,rolls}),positions=filamentPositions(p,rolls);
  assert.deepEqual(positions.map(s=>s.key),['ams:0:0','ams:128:0','external:254:0','external:255:0']);
  assert.equal(positions.at(-1).spool.id,'ext2');assert.equal(positions.at(-1).label,'Externo 2');
  assert.equal(JSON.stringify({p,rolls}),before);
  assert.deepEqual(filamentPositions({...p,unlinked:true},rolls),[]);
  assert.deepEqual(filamentPositions(printer({model:'P1S',telemetry:{slots:[]}}),[]).map(s=>s.key),['external:254:0']);
});

test('picker allows only mounted compatible stock and keeps printer color conflicts advisory',()=>{
  const p=printer(),rolls=[spool('001',0),spool('002',1,{material:'PETG'}),spool('003',2,{color:'#FFFFFF'}),spool('004',null)];
  p.telemetry.slots[0].color='BBBBBBFF';
  const choices=filamentChoices(p,rolls,filament);
  assert.deepEqual(choices.filter(s=>s.usable).map(s=>s.spool.id),['001']);
  assert.match(choices[1].reason,/Material distinto/);assert.match(choices[2].reason,/Color distinto/);
  assert(!choices.some(s=>s.spool?.id==='004'));
  const html=filamentPicker({printer:p,spools:rolls,filament,esc});
  assert.doesNotMatch(html,/<select| checked/);assert.equal((html.match(/name="map-1"/g)||[]).length,3);
  assert.equal((html.match(/type="radio"/g)||[]).length,3);assert.match(html,/required disabled/);
  const selected=filamentPicker({printer:p,spools:rolls,filament,selected:'ams:0:0',esc});
  assert.equal((selected.match(/ checked/g)||[]).length,1);
});

test('empty, missing, stale, changed RFID and uncertain stock cannot be selected',()=>{
  for(const kind of ['empty','missing','stale','rfid','uncertain','zero','material']) {
    const p=printer(),s=spool('001',0);
    if(kind==='empty')p.telemetry.slots[0].empty=true;
    if(kind==='missing')p.telemetry.slots=[];
    if(kind==='stale')p.telemetry.fresh=false;
    if(kind==='rfid'){s.mount.observedTagUid='old';p.telemetry.slots[0].tagUid='new';}
    if(kind==='uncertain')s.stockUncertain=true;
    if(kind==='zero')s.remainingGrams=0;
    if(kind==='material')p.telemetry.slots[0].material='PETG';
    assert.equal(filamentChoices(p,[s],filament).find(s=>s.spool?.id==='001').usable,false,kind);
  }
});

test('color dots escape labels and distinguish unknown colors, inventory and current-job allocation',()=>{
  const p=printer(),s=spool('<img onerror=x>',0,{color:'red;background:url(x)'});p.telemetry.slots[0].color='00000000';
  const state={connected:true,data:{printers:[p],inventory:{spools:[s]}}};
  const ui=createIpadInventory({state,esc}),html=ui.loaded(p,{active:{attempt:{allocations:[{spoolId:s.id}]}}});
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|url\(x\)/);
  assert.match(html,/in-job/);assert.match(html,/En esta placa/);assert.match(html,/is-unknown/);
  assert.match(ui.loaded({...p,telemetry:{...p.telemetry,fresh:false}},{}),/Último registro/);
});

test('viewing dots while printing, paused, collecting or offline is read only',()=>{
  for(const [status,active,fresh] of [['printing',null,true],['paused',null,true],['finished',{attempt:{}},true],['idle',null,false]]) {
    const p=printer();Object.assign(p.telemetry,{status,fresh});
    const state={connected:true,data:{printers:[p],queues:[{printerId:'p',active}],inventory:{spools:[spool('001',0)]}}};
    let form,writes=0;
    const ui=createIpadInventory({state,esc,openForm:(...args)=>form=args,mutate:()=>writes++});
    ui.change('p','ams:0:0');
    assert.equal(form[3].hideSubmit,true);assert.doesNotMatch(form[1],/name="spoolId"/);assert.equal(writes,0);
    assert(filamentChangeReason(p,state.data.queues[0]));
  }
});

test('changing a bobina uses existing inventory API, keeps jobs and weights intact, releases the former roll and never starts printing',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  t.after(()=>{inventory.close();production.close();});
  const file=path.join(f.dir,'plate.gcode.3mf');await writeArchive(file);
  const item=await production.importFile(file,'plate');
  const create=(name,key)=>inventory.create({name,material:'PLA',color:'#FFFFFF',remainingGrams:1000,basis:'measured'},key);
  const first=create('001','create-first'),second=create('002','create-second');
  inventory.bind(f.printer.id,{source:'ams',amsId:0,slotId:0,spoolId:first.id,confirmed:true},'mount-first');
  production.add(f.printer.id,{libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:true,amsMapping:[0]}},'queue-jobs');
  const jobsBefore=JSON.stringify(f.store.jobs(f.printer.id));let captured,count=0;
  const state={connected:true,data:null};
  const refresh=async()=>{state.data={printers:[{...f.printer,telemetry:f.transport.status(f.printer.id)}],queues:[production.queue(f.printer.id)],inventory:inventory.overview()};};
  await refresh();
  const ui=createIpadInventory({state,esc,refresh,toast(){},openForm:(...args)=>captured=args,mutate:async(route,body)=>{
    assert.equal(route,`/api/printers/${f.printer.id}/materials`);
    return inventory.bind(f.printer.id,body,'change-'+(++count));
  }});
  ui.change(f.printer.id,'ams:0:0');assert.equal(captured[3].hideSubmit,false);
  await assert.rejects(()=>captured[2]({spoolId:second.id}),/Confirma/);
  await captured[2]({spoolId:second.id,confirmed:'on'});
  assert.equal(inventory.view(first.id).mount,null);assert.equal(inventory.view(second.id).mount.slotId,0);
  assert.equal(inventory.view(first.id).remainingGrams,1000);assert.equal(inventory.view(second.id).remainingGrams,1000);
  assert.equal(JSON.stringify(f.store.jobs(f.printer.id)),jobsBefore);assert.equal(f.transport.calls.length,0);
  await refresh();ui.change(f.printer.id,'ams:0:0');
  await captured[2]({spoolId:'empty',confirmed:'on'});
  assert.equal(inventory.view(second.id).mount,null);assert.equal(production.queue(f.printer.id).pending[0].materialPlan.state,'blocked');
  assert.equal(JSON.stringify(f.store.jobs(f.printer.id)),jobsBefore);assert.equal(f.transport.calls.length,0);
});

test('an open change dialog rechecks current printer, inventory and assignment before posting',async()=>{
  const p=printer(),first=spool('001',0),second=spool('002',null);
  const state={connected:true,data:{printers:[p],queues:[{printerId:p.id,active:null}],inventory:{spools:[first,second]}}};
  let form,writes=0;
  const ui=createIpadInventory({state,esc,openForm:(...args)=>form=args,mutate:()=>writes++,toast(){}});
  ui.change('p','ams:0:0');p.telemetry.status='printing';
  await assert.rejects(()=>form[2]({spoolId:'002',confirmed:'on'}),/lectura del AMS/);
  p.telemetry.status='idle';second.mount={printerId:'other',source:'external',amsId:254,slotId:0};
  await assert.rejects(()=>form[2]({spoolId:'002',confirmed:'on'}),/Cargada/);
  second.mount=null;first.mount=null;
  await assert.rejects(()=>form[2]({spoolId:'002',confirmed:'on'}),/posición cambió/);
  assert.equal(writes,0);
});

test('the real queue form submits one chosen dot per filament and preserves explicit nozzle mappings',async()=>{
  const p=printer({model:'X2D'});p.telemetry.slots=[slot(0),slot(0,{source:'external',amsId:255,color:'FFFFFFFF',material:'PETG'})];
  const rolls=[spool('001',0),spool('002',0,{material:'PETG',color:'#FFFFFF',mount:{printerId:'p',source:'external',amsId:255,slotId:0}})];
  const pl={index:1,model:'X2D',objectCount:1,filaments:[filament,{id:2,type:'PETG',color:'#FFFFFF',grams:10}]};
  const file={id:'file',name:'Two materials',plates:[pl]};
  const existing={id:'job',printerId:'p',libraryId:'file',plate:1,pieces:1,label:'Existing',settings:{useAms:true,filamentMapping:[{amsId:0,slotId:0},{amsId:255,slotId:0}],nozzleMapping:[1,0]}};
  const prior=JSON.stringify(existing),elements={};
  for(const [name,value]of Object.entries({libraryId:'file',printerId:'p',plate:'1',piecesPerPlate:'1',label:'Existing'}))elements[name]={value,addEventListener(){}};
  const form={elements,addEventListener(){}},dom=new Map(),requests=[];let captured;
  elements['change-filament']={checked:false,addEventListener(){}};
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const ctx={uiText,ht,locale,translateMessage,languageSelector,state:{connected:true,data:{library:[file],printers:[p],inventory:{spools:rolls}}},file:()=>file,printer:()=>p,esc,g:String,modelLabel:s=>s,filamentChoices,filamentPicker,
    select:(label,name)=>`<select name="${name}">${label}</select>`,field:()=>'',uploadForm(){throw Error('Unexpected upload');},toast(){},navigate(){},
    $:selector=>{if(!dom.has(selector))dom.set(selector,{innerHTML:'',addEventListener(){}});return dom.get(selector);},
    openForm:(title,body,submit,options)=>{captured={title,body,submit,options};options.after(form);},
    mutate:async(route,body)=>requests.push({route,body})};
  vm.runInNewContext(source.slice(source.indexOf('function jobForm('),source.indexOf('function dispatchForm(')),ctx);
  ctx.jobForm({job:existing});
  const html=dom.get('#mapping-fields').innerHTML;
  assert.doesNotMatch(html,/<select name="map-/);assert.match(html,/name="map-1"/);assert.match(html,/name="map-2"/);
  assert.equal((html.match(/ checked/g)||[]).length,2);assert.equal(requests.length,0);
  await assert.rejects(()=>captured.submit({libraryId:'file',printerId:'p',plate:'1'},form),/selecciona una bobina/);
  await captured.submit({libraryId:'file',printerId:'p',plate:'1',label:'Existing','map-1':'ams:0:0','map-2':'external:255:0','nozzle-1':'1','nozzle-2':'0'},form);
  assert.equal(requests[0].route,'/api/printers/p/queue/job/edit');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body.settings)),existing.settings);
  assert.equal(JSON.stringify(existing),prior);
});
