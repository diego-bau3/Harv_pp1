import {t as uiText,ht,locale,translateMessage,languageSelector,setLanguage} from '../public/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {fixture,fresh,writeArchive} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {InventoryService} from '../src/inventory.mjs';
import {createApi} from '../src/api.mjs';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function formFor(printer,active,mutate) {
  let form;
  const context={uiText,ht,locale,translateMessage,languageSelector,printer:()=>printer,queue:()=>({active}),mutate,toast(){},g:String,esc:String,button:()=>'',field:()=>'',select:()=>'',note:()=>'',check:()=>'',
    openForm:(title,body,submit,options)=>{form={title,body,submit,options};}};
  vm.runInNewContext(app.slice(app.indexOf('function collectForm('),app.indexOf('function queueDialog(')),context);
  context.collectForm(printer.id);return form;
}

test('English collection submits the same counts, outcome and physical confirmations',async()=>{
  const p={id:'p',name:'P1S',telemetry:fresh()};
  const active={job:{pieces:1,label:'Blanco'},attempt:{id:'a',state:'awaiting_collection',collectionConflict:true},materialUsage:{status:'settled'}};
  const collect=async language=>{
    setLanguage(language,{reload:false});
    const writes=[],form=formFor(p,active,async(route,body)=>writes.push({route,body}));
    await form.submit({good:'0',rejected:'0',outcome:'aborted',note:'nada',bedCleared:'on',printerChecked:'on'});
    return JSON.parse(JSON.stringify(writes));
  };
  try{assert.deepEqual(await collect('en'),await collect('es'));}
  finally{setLanguage('es',{reload:false});}
});

test('short or empty collection comments retain the selected result and require both physical confirmations',async()=>{
  const p={id:'p',name:'P1S',telemetry:fresh()};
  const active={job:{pieces:1,label:'Plate'},attempt:{id:'a',state:'awaiting_collection',collectionConflict:true},materialUsage:{status:'settled'}};
  const writes=[],form=formFor(p,active,async(route,body)=>writes.push({route,body}));
  const input={good:'0',rejected:'0',outcome:'aborted',note:'nada',bedCleared:'on',printerChecked:'on'};
  await assert.rejects(()=>form.submit({...input,bedCleared:undefined}),/cama/);
  await assert.rejects(()=>form.submit({...input,printerChecked:undefined}),/físicamente/);
  assert.equal(writes.length,0);
  for(const note of ['nada','ok','','   '])await form.submit({...input,note});
  for(const {body}of writes){assert.equal(body.bedCleared,true);assert.equal(body.printerChecked,true);assert.equal(body.outcome,'aborted');assert.equal(body.good,0);assert.equal(body.rejected,0);assert.match(body.note,/No se produjo ninguna pieza/);}
  assert.match(writes[0].body.note,/Observación: nada$/);assert.match(writes[1].body.note,/Observación: ok$/);
  assert.doesNotMatch(writes[2].body.note,/Observación/);
  await form.submit({...input,good:'1',outcome:'finished',note:'ok'});
  assert.match(writes[4].body.note,/Terminó la impresión. Piezas buenas: 1/);
  await form.submit({...input,rejected:'1',outcome:'failed',note:'ok'});
  assert.match(writes[5].body.note,/La impresión falló. Piezas buenas: 0; rechazadas: 1/);
});

test('the exact nada submission succeeds through the collection API once, preserving stock and pending queue',async t=>{
  const f=await fixture(t),production=new ProductionService(f),inventory=new InventoryService({store:f.store,production});
  const server=createApi({...f,production,inventory,token:'collection-note-test'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));inventory.close();production.close();});
  const file=path.join(f.dir,'plate.gcode.3mf');await writeArchive(file);f.transport.uploadBytes=(await stat(file)).size;
  const item=await production.importFile(file,'Plate'),id=f.printer.id;
  const spool=inventory.create({name:'Blanco',material:'PLA',color:'#FFFFFF',remainingGrams:1000,basis:'measured'},'note-spool');
  inventory.bind(id,{source:'ams',amsId:0,slotId:0,spoolId:spool.id,confirmed:true},'note-bind');
  const jobs=production.add(id,{libraryId:item.id,plate:1,piecesPerPlate:1,repetitions:2,settings:{useAms:true,amsMapping:[0]}},'note-jobs').jobs;
  const a=(await production.dispatch(id,{jobId:jobs[0].id,bedCleared:true,setupConfirmed:true},'note-dispatch')).attempt;
  const op=f.store.request(id,a.startKey),report=s=>{f.transport.states.set(id,s);f.transport.emit('telemetry',id,s);};
  report(fresh({status:'finished',progress:100,currentJob:{name:op.packet.print.subtask_name,file:op.packet.print.file}}));
  report(fresh({status:'printing',currentJob:{name:'External Studio print',file:'external.3mf'}}));report(fresh());
  const active=production.queue(id).active,stock=JSON.stringify(inventory.view(spool.id)),ledger=JSON.stringify(f.store.ledger(spool.id)),pending=JSON.stringify(f.store.job(jobs[1].id)),calls=f.transport.calls.length;
  const url=`http://127.0.0.1:${server.address().port}`;
  const form=formFor({...f.printer,telemetry:f.transport.status(id)},active,async(route,body)=>{
    const response=await fetch(url+route,{method:'POST',headers:{Authorization:'Bearer collection-note-test','Content-Type':'application/json','Idempotency-Key':'review-nada'},body:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  });
  const input={good:'0',rejected:'0',outcome:'aborted',note:'nada',bedCleared:'on',printerChecked:'on'};
  await form.submit(input);await form.submit(input);
  assert.equal(f.store.active(id),undefined);assert.equal(f.store.attempt(a.id).state,'collected');
  const collection=f.store.collection(a.id);assert.equal(collection.printerChecked,true);assert.match(collection.note,/Observación: nada$/);assert.equal(collection.outcome,'aborted');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM collections').get().n,1);
  assert.equal(JSON.stringify(inventory.view(spool.id)),stock);assert.equal(JSON.stringify(f.store.ledger(spool.id)),ledger);
  assert.equal(JSON.stringify(f.store.job(jobs[1].id)),pending);assert.equal(f.transport.calls.length,calls);
});
