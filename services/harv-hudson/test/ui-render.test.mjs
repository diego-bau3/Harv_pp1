import {t as uiText,ht,locale,translateMessage,languageSelector,setLanguage} from '../public/i18n.js';
import {createStatistics} from '../public/statistics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { demoRequest } from '../public/demo.js';
import { createIpad } from '../public/ipad.js';
import { filamentPicker,filamentChoices,openSpoolForm,openDeleteSpoolForm,openDeleteAllSpoolsForm } from '../public/ipad-inventory.js';
import { plannedFilamentPicker,plannedSpoolChoices,plannedChanges,plannedChangeSummary } from '../public/planned-filament.js';
import { filamentAlert,operatorState } from '../public/ipad-state.js';
import { cameraStage } from '../public/cameras.js';
import { discoveryPanel as renderDiscoveryPanel } from '../public/discovery.js';

// Execute the actual UI module against in-memory DOM slots and a fixture API.
// This covers runtime rendering (syntax checks cannot detect a missing helper).
async function ui(url,data) {
  const slots=new Map();
  const element=key=>{
    if(!slots.has(key))slots.set(key,{innerHTML:'',textContent:'',open:false,
      insertAdjacentHTML(){},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},focus(){},
      querySelector:s=>element(s),querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}});
    return slots.get(key);
  };
  const document={querySelector:element,querySelectorAll:()=>[],documentElement:element('html'),addEventListener(){},hidden:false};
  const calls=[];
  const context={createStatistics,URLSearchParams,uiText,ht,locale,translateMessage,languageSelector,document,location:new URL(url),URL,Intl,Date,console,AbortSignal,
    window:{addEventListener(){},scrollTo(){}},history:{replaceState(){}},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
    demoRequest,createIpad,filamentPicker,filamentChoices,openSpoolForm,openDeleteSpoolForm,openDeleteAllSpoolsForm,plannedFilamentPicker,plannedSpoolChoices,plannedChanges,plannedChangeSummary,filamentAlert,operatorState,cameraStage,createCameras:()=>({sync(){}}),renderDiscoveryPanel,
    fetch:async route=>{calls.push(route);if(route==='/api/ui/session')return Response.json({authenticated:true,local:true});if(route==='/api/dashboard')return Response.json(data);throw new Error(`Unexpected UI request: ${route}`);}};
  const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const app=await vm.runInNewContext(`(async()=>{${source}\nreturn {navigate,refresh,action,connected:()=>state.connected};})()`,context,{timeout:1000});
  return {app,document,slots,calls};
}

test('nonempty library renders after production and permits returning to the other workspace pages',async()=>{
  const page=await ui('http://127.0.0.1:8788/?demo=1');
  assert.match(page.slots.get('#main').innerHTML,/Cámara P1S/);
  page.app.navigate('library');
  const library=page.slots.get('#main').innerHTML;
  assert.match(library,/library-card/);assert.match(library,/Agregar a la cola/);assert.match(library,/part-art/);
  for(const section of ['inventory','history','ipad','production']){
    page.app.navigate(section);assert.ok(page.slots.get('#main').innerHTML.length>100);
  }
  assert.equal(page.app.connected(),true);assert.equal(page.calls.length,0);
});

test('Filament and iPad expose delete confirmation for the exact spool and hide archived spools after refresh',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const unused={...data.inventory.spools[0],id:'unused-test-spool',name:'Spare delete test',mount:null,reservedGrams:0,archived:false};
  data.inventory.spools.push(unused);
  for(const lang of ['es','en']){
    setLanguage(lang,{reload:false});
    try{
      const page=await ui('http://127.0.0.1:8788/#inventory',data);
      assert.match(page.slots.get('#main').innerHTML,/data-action="delete-spool" data-id="unused-test-spool"/);
      await page.app.action({dataset:{action:'delete-spool',id:unused.id}});
      assert.match(page.slots.get('#dialog').innerHTML,/Spare delete test/);
      assert.match(page.slots.get('#dialog').innerHTML,lang==='en'?/Delete spool/:/Eliminar bobina/);
      await page.app.action({dataset:{action:'close-dialog'}});
      page.app.navigate('ipad');await page.app.action({dataset:{action:'operator-tab',section:'inventory'}});
      assert.match(page.slots.get('#main').innerHTML,/data-action="operator-delete-spool" data-id="unused-test-spool"/);
      await page.app.action({dataset:{action:'operator-delete-spool',id:unused.id}});
      assert.match(page.slots.get('#dialog').innerHTML,/Spare delete test/);
      await page.app.action({dataset:{action:'close-dialog'}});
      unused.archived=true;await page.app.refresh();assert.doesNotMatch(page.slots.get('#main').innerHTML,/Spare delete test/);
      page.app.navigate('inventory');assert.doesNotMatch(page.slots.get('#main').innerHTML,/Spare delete test/);
      unused.archived=false;
      assert.ok(page.calls.every(route=>['/api/ui/session','/api/dashboard'].includes(route)));
    }finally{setLanguage('es',{reload:false});}
  }
});

test('Delete all opens a reviewed batch from both PC and iPad without any write',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  for(const lang of ['en','es']){
    setLanguage(lang,{reload:false});
    try{
      const page=await ui('http://127.0.0.1:8788/#inventory',data);
      const label=lang==='en'?'Delete all':'Eliminar todas';
      assert.match(page.slots.get('#main').innerHTML,new RegExp('data-action="delete-all-spools"[^>]*>[^]*?'+label));
      await page.app.action({dataset:{action:'delete-all-spools'}});
      assert.match(page.slots.get('#dialog').innerHTML,new RegExp(label));
      assert.match(page.slots.get('#dialog').innerHTML,/name="confirmDelete"/);
      await page.app.action({dataset:{action:'close-dialog'}});
      page.app.navigate('ipad');await page.app.action({dataset:{action:'operator-tab',section:'inventory'}});
      assert.match(page.slots.get('#main').innerHTML,new RegExp('data-action="operator-delete-all-spools"[^>]*>'+label));
      await page.app.action({dataset:{action:'operator-delete-all-spools'}});
      assert.match(page.slots.get('#dialog').innerHTML,/name="confirmDelete"/);
      assert.ok(page.calls.every(route=>['/api/ui/session','/api/dashboard'].includes(route)));
    }finally{setLanguage('es',{reload:false});}
  }
});

test('library and history previews select the exact plate including removed files, and enlargement is read only',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const item=data.library[0];item.id='b'.repeat(64);item.name='Stencil <cuatro>';item.plates=[{...item.plates[0],index:4}];
  data.library=[item];data.jobFiles=[];
  const job=data.queues[0].history[0];job.libraryId=item.id;job.plate=4;
  const before=JSON.stringify(data);
  const page=await ui('http://127.0.0.1:8788/#library',data);
  assert.match(page.slots.get('#main').innerHTML,new RegExp('/api/library/'+item.id+'/plates/4/thumbnail'));
  assert.doesNotMatch(page.slots.get('#main').innerHTML,/plates\/1\/thumbnail/);
  await page.app.action({dataset:{action:'plate-preview',id:item.id,plate:'4'}});
  assert.equal(page.slots.get('#dialog').open,true);
  assert.match(page.slots.get('#dialog').innerHTML,/Stencil &lt;cuatro&gt;/);
  assert.match(page.slots.get('#dialog').innerHTML,/plate-preview-large/);
  assert.doesNotMatch(page.slots.get('#dialog').innerHTML,/id="modal-submit"/);
  await page.app.action({dataset:{action:'close-dialog'}});
  assert.equal(JSON.stringify(data),before);
  data.library=[];data.jobFiles=[item];page.app.navigate('history');
  assert.match(page.slots.get('#main').innerHTML,new RegExp('/api/library/'+item.id+'/plates/4/thumbnail'));
  await page.app.action({dataset:{action:'plate-preview',id:item.id,plate:'4'}});
  assert.match(page.slots.get('#dialog').innerHTML,/Vista de Bambu Studio · Placa 4/);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('a Studio receipt renders the imported file and offers Preparar cola without submitting another import or print',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const file=data.library[0];file.id='a'.repeat(64);file.name='Placa enviada desde Studio';data.library=[file];
  const page=await ui(`http://127.0.0.1:8788/?desktop=1&shell=1&from=studio&file=${file.id}#library`,data);
  assert.equal(page.app.connected(),true);
  assert.match(page.slots.get('#main').innerHTML,/Placa enviada desde Studio/);
  const dialog=page.slots.get('#dialog');assert.equal(dialog.open,true);
  assert.match(dialog.innerHTML,/Recibido desde Bambu Studio/);assert.match(dialog.innerHTML,/Preparar cola/);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('iPad inventory stays inside the operator screen, survives refresh and returns to the printer controls',async()=>{
  for(const url of ['http://127.0.0.1:8788/ipad?demo=1','http://127.0.0.1:8788/?demo=1#ipad']) {
    const page=await ui(url),markup=()=>page.slots.get('#main').innerHTML;
    assert.match(markup(),/operator-grid/);assert.match(markup(),/>Inventario<\/button>/);
    await page.app.action({dataset:{action:'operator-tab',section:'inventory'}});
    assert.match(markup(),/Agregar filamento/);assert.match(markup(),/ipad-spool-card/);
    assert.doesNotMatch(markup(),/operator-grid|operator-failed/);
    await page.app.refresh();assert.match(markup(),/ipad-spool-card/);
    await page.app.action({dataset:{action:'operator-tab',section:'printers'}});
    assert.match(markup(),/operator-grid/);assert.match(markup(),/operator-failed/);
    assert.equal(page.calls.length,0);
  }
});

test('iPad exposes loaded bobinas above each printer and opens an active roll as read-only without any write',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard')),p=data.printers[1];
  p.telemetry.filamentUse={known:true,mode:'legacy',count:1,current:['ams:0:0'],target:['ams:0:0']};p.telemetry.filamentUseFresh=true;
  const before=JSON.stringify({queues:data.queues,spools:data.inventory.spools});
  const page=await ui('http://127.0.0.1:8788/ipad',data),html=page.slots.get('#main').innerHTML;
  assert.match(html,/operator-filaments[^]*?<h2>A1<\/h2>/);
  assert.match(html,/En uso/);
  await page.app.action({dataset:{action:'operator-filament',id:p.id,source:'ams:0:0'}});
  const dialog=page.slots.get('#dialog');
  assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/Filamento cargado/);
  assert.match(dialog.innerHTML,/En uso: esta bobina está alimentando la impresora/);
  assert.doesNotMatch(dialog.innerHTML,/name="spoolId"|Confirmar cambio/);
  assert.equal(JSON.stringify({queues:data.queues,spools:data.inventory.spools}),before);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('iPad recovery replaces Failed and asks for a physical check without dispatching',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const p=data.printers[0],q=data.queues.find(q=>q.printerId===p.id);
  p.telemetry={fresh:true,status:'finished',progress:100,currentJob:{name:'Impresión anterior',file:'old.3mf'}};
  q.active={job:{label:'Trabajo que no comenzó'},attempt:{id:'recover-attempt',state:'review'},startOperation:{status:'rejected',packet:{print:{subtask_name:'new-job',file:'new.3mf'}}},recovery:{available:true}};
  const page=await ui('http://127.0.0.1:8788/ipad',data);
  assert.match(page.slots.get('#main').innerHTML,/operator-recover/);
  assert.match(page.slots.get('#main').innerHTML,/operator-card operator-attention/);
  assert.doesNotMatch(page.slots.get('#main').innerHTML,/class="operator-card attention"/);
  await page.app.action({dataset:{action:'operator-recover',id:p.id}});
  const dialog=page.slots.get('#dialog');assert.equal(dialog.open,true);
  assert.match(dialog.innerHTML,/no salió filamento/);assert.match(dialog.innerHTML,/checkbox.*required/);
  assert.match(dialog.innerHTML,/Repetir este trabajo/);assert.match(dialog.innerHTML,/Saltar este trabajo · Seguir cola/);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('iPad and Production show required versus assigned filament and a blocked job has no start confirmation',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const p=data.printers[0],q=data.queues.find(q=>q.printerId===p.id);
  p.telemetry={fresh:true,status:'idle',slots:[],currentJob:{name:'',file:''}};q.active=null;
  const job=q.pending[0];
  job.materialPlan={state:'blocked',issues:[{code:'COLOR_MISMATCH',message:'El color del rollo no coincide con el archivo.',
    source:{source:'ams',amsId:0,slotId:2},expected:{material:'PLA',color:'#FFFFFF'},loaded:{name:'Negro <script>',material:'PLA',color:'#000000'}}]};
  const page=await ui('http://127.0.0.1:8788/ipad',data);
  for(const section of ['ipad','production']){
    page.app.navigate(section);const html=page.slots.get('#main').innerHTML;
    assert.match(html,/Filamento distinto/);assert.match(html,/PLA blanco/);assert.match(html,/PLA negro/);
    assert.match(html,/Posición 3/);assert.match(html,/Negro &lt;script&gt;/);assert.doesNotMatch(html,/Negro <script>/);
  }
  await page.app.action({dataset:{action:'dispatch',id:p.id}});
  const dialog=page.slots.get('#dialog');assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/Revisar filamento/);
  assert.doesNotMatch(dialog.innerHTML,/Iniciar impresión/);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('desktop review of an unstarted attempt uses the zero-consumption recovery flow and does not borrow another prints 100 percent',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const p=data.printers[0],q=data.queues.find(q=>q.printerId===p.id);
  data.printers=[p];data.queues=[q];
  p.telemetry={fresh:true,status:'finished',progress:100,currentJob:{name:'Previous print',file:'old.3mf'}};
  q.active={job:{label:'Unstarted job',pieces:1},attempt:{id:'unstarted',state:'review'},startOperation:{status:'resolved',packet:{print:{subtask_name:'not-started',file:'new.3mf'}}},recovery:{available:true}};
  const page=await ui('http://127.0.0.1:8788/',data);
  const html=page.slots.get('#main').innerHTML;
  assert.match(html,/Sin progreso confirmado/);assert.doesNotMatch(html,/100<small>%/);
  await page.app.action({dataset:{action:'collect',id:p.id}});
  const dialog=page.slots.get('#dialog');
  assert.match(dialog.innerHTML,/no salió filamento/);assert.match(dialog.innerHTML,/Saltar este trabajo · Seguir cola/);
  assert.doesNotMatch(dialog.innerHTML,/Confirmar recolección|Piezas buenas|gramos consumidos/);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('iPad schedules render beneath the current name and beside queue status using archived metadata without modifying jobs',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard')),before=JSON.stringify(data.queues);
  const p=data.printers[0],q=data.queues.find(q=>q.printerId===p.id),file=data.library.find(f=>f.id===q.pending[0].libraryId);
  data.jobFiles=[file];data.library=data.library.filter(f=>f.id!==file.id);
  const page=await ui('http://127.0.0.1:8788/ipad',data),html=page.slots.get('#main').innerHTML;
  assert.match(html,/operator-current[^]*?operator-finish[^]*?Término:/);
  assert.match(html,/operator-queue-plan[^]*?Espera su turno[^]*?Término esperado/);
  assert.match(html,/Duración: 2 h 30 min/);assert.match(html,/5 min de limpieza/);
  assert.equal(JSON.stringify(data.queues),before);
  assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});

test('desktop stock review routes to explicit collection and retains physical review after an external print',async()=>{
  const data=structuredClone(await demoRequest('/api/dashboard'));
  const p=data.printers[0],q=data.queues.find(q=>q.printerId===p.id),s=data.inventory.spools[0];
  s.stockUncertain=true;s.uncertaintyReason='Impresión fuera del intento de Hudson; consumo sin contabilizar.';
  s.mount={printerId:p.id,source:'external',amsId:254,slotId:0};
  p.telemetry={fresh:true,status:'finished',currentJob:{name:'hudson-original',file:''}};
  q.active={job:{label:'Placa anterior',pieces:1},attempt:{id:'attempt',state:'awaiting_collection',collectionConflict:true,allocations:[{spoolId:s.id}]},
    startOperation:{status:'confirmed',packet:{print:{subtask_name:'hudson-original'}}},materialUsage:{status:'settled',totalGrams:30},operatorCollection:{available:false}};
  const before=JSON.stringify(data),page=await ui('http://127.0.0.1:8788/#inventory',data);
  assert.match(page.slots.get('#main').innerHTML,/g registrados · por revisar/);
  await page.app.action({dataset:{action:'weigh',id:s.id}});
  assert.match(page.slots.get('#dialog').innerHTML,/Revisar placa anterior/);
  assert.doesNotMatch(page.slots.get('#dialog').innerHTML,/name="remainingGrams"/);
  await page.app.action({dataset:{action:'collect',id:p.id}});
  assert.match(page.slots.get('#dialog').innerHTML,/Revisar y recolectar/);
  assert.match(page.slots.get('#dialog').innerHTML,/name="printerChecked"/);
  assert.match(page.slots.get('#dialog').innerHTML,/Nota adicional · opcional/);
  assert.doesNotMatch(page.slots.get('#dialog').innerHTML,/name="note"[^>]*(required|minlength)/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
});


test('all workspace pages render in English, retain user names and leave production data unchanged',async()=>{
  setLanguage('en',{reload:false});
  try{
    const data=structuredClone(await demoRequest('/api/dashboard'));
    data.library[0].name='Blanco <Cliente> {0}';
    const before=JSON.stringify(data);
    const page=await ui('http://127.0.0.1:8788/#production',data);
    for(const [key,title]of [['production','Production'],['library','Library'],['inventory','Filament'],['history','History'],['settings','Settings'],['ipad','IPAD']]){
      page.app.navigate(key);const html=page.slots.get('#main').innerHTML;
      assert.ok(html.includes(title),key);
      assert.doesNotMatch(html,/>Producción<|>Agregar trabajo<|>Ajustes<|>Retirar<|>Esperando<|>Actualizar peso</);
    }
    page.app.navigate('library');assert.match(page.slots.get('#main').innerHTML,/Blanco &lt;Cliente&gt; \{0\}/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(page.calls,['/api/ui/session','/api/dashboard']);
  }finally{setLanguage('es',{reload:false});}
});
