// In-memory design preview. This module never sends a request to a real printer/API.
const clone=x=>structuredClone(x),id=()=>`demo-${Math.random().toString(36).slice(2,12)}`;
const today=new Date().toISOString();
const models=['P1S','A1','X1C','X2D'];
const titles=['Organizador modular','Maceta estriada','Soporte para audífonos','Base de exhibición'];
const names=['PLA · Arena','PLA · Terracota','PLA · Marfil','PETG · Blanco','TPU · Grafito','PLA · Negro'];
const colors=['#C8B59B','#B66B4F','#DED5BD','#EEEDE4','#62645D','#363832'];
const weights=[428,94,712,856,364,1000];
const files=models.map((model,i)=>({id:`file-${i}`,name:titles[i],bytes:1850000+i*274000,createdAt:today,plates:[{index:1,model,nozzleDiameters:model==='X2D'?[.4,.4]:[.4],objectCount:[6,3,4,2][i],predictedSeconds:[9000,7200,12000,10800][i],filaments:[{id:1,type:i===3?'PETG':'PLA',color:colors[i],grams:[38.4,24.6,57.2,40][i]},...(i===3?[{id:2,type:'TPU',color:colors[4],grams:8}]:[])]}]}));
files.push({...clone(files[0]),id:'file-4',name:'Bandeja de escritorio'},{...clone(files[1]),id:'file-5',name:'Clip para cables'});
const spools=names.map((name,i)=>({id:`spool-${i}`,name,material:i===3?'PETG':i===4?'TPU':'PLA',color:colors[i],brand:'Print3d',remainingGrams:weights[i],reservedGrams:[120,135,200,80,16,0][i],availableGrams:weights[i]-[120,135,200,80,16,0][i],lowGrams:100,balanceIsEstimate:true,basis:'estimated',archived:false,alerts:i===1?['LOW_STOCK','QUEUE_SHORTAGE']:[],mount:i<5?{printerId:`printer-${i===4?3:i}`,source:i===0||i===4?'external':'ams',amsId:i===0||i===4?254:0,slotId:0}:null}));
const printers=models.map((model,i)=>({id:`printer-${i}`,name:model==='X1C'?'X1 Carbon':model,model,serial:`DEMO${model}001`,ipAddress:`192.168.1.${100+i}`,nozzleDiameters:model==='X2D'?[.4,.4]:[.4],hasAccessCode:true,telemetry:{fresh:true,connectionState:'connected',status:i===2?'finished':'printing',progress:[42,68,100,23][i],remainingMinutes:[82,36,0,136][i],temperatures:{nozzle:i===2?35:215,bed:i===2?29:60},slots:[{source:i===0?'external':'ams',amsId:i===0?254:0,slotId:0,material:i===3?'PETG':'PLA',color:colors[i],empty:false},...(i===3?[{source:'external',amsId:254,slotId:0,material:'TPU',color:colors[4],empty:false}]:[])],currentJob:{name:`demo-print-${i}`,file:`demo-${i}.3mf`},errors:{printError:0}}}));
function job(i,label,number){return {id:`job-${i}-${number}`,rootId:`job-${i}-${number}`,printerId:`printer-${i}`,libraryId:`file-${i}`,plate:1,pieces:[6,3,4,2][i],label,state:'queued',position:number,createdAt:today,settings:{useAms:i!==0,filamentMapping:i===3?[{amsId:0,slotId:0},{amsId:254,slotId:0}]:[{amsId:i===0?254:0,slotId:0}],...(i===3?{nozzleMapping:[0,1]}:{})},materialPlan:{state:'ready',issues:[]}};}
const queues=printers.map((p,i)=>{
  const activeJob=job(i,titles[i],0),attempt={id:`attempt-${i}`,jobId:activeJob.id,printerId:p.id,state:i===2?'awaiting_collection':'printing',outcome:i===2?'finished':undefined,createdAt:today,allocations:files[i].plates[0].filaments.map((f,k)=>({filamentId:f.id,spoolId:`spool-${i===3&&k===1?4:i}`,plannedMg:f.grams*1000}))};
  return {printerId:p.id,telemetry:p.telemetry,active:{job:activeJob,attempt,startOperation:{id:`op-${i}`,status:'confirmed',packet:{print:{subtask_name:p.telemetry.currentJob.name,file:p.telemetry.currentJob.file}}},materialUsage:i===2?{status:'settled',totalGrams:57.2,method:'slicer-total'}:null},pending:[job(i,`${titles[i]} · Lote 02`,1),job(i,`${titles[i]} · Lote 03`,2)],history:[{...job(i,'Producción de la mañana',-1),state:'collected',collection:{at:today,good:[16,12,20,16][i],rejected:i===1?1:0,outcome:'finished'},attemptId:`old-${i}`}],counts:{good:[16,12,20,16][i],rejected:i===1?1:0},automaticStart:false};
});
let data={printers,queues,library:files,inventory:{spools,policy:{reservePercent:10,reserveGrams:2},alerts:[{code:'QUEUE_SHORTAGE',spoolId:'spool-1',name:names[1]}],pendingUsage:[],plans:[],notificationDelivery:'api-only'},network:{local:true,lanEnabled:false,urls:[]},events:[],at:today};
const ledger={};
function recalc(){for(const s of data.inventory.spools){s.availableGrams=s.remainingGrams-s.reservedGrams;s.alerts=s.remainingGrams<100?['LOW_STOCK']:[];if(s.availableGrams<0)s.alerts.push('QUEUE_SHORTAGE');}data.inventory.alerts=data.inventory.spools.flatMap(s=>s.alerts.map(code=>({code,spoolId:s.id,name:s.name})));}
export async function demoRequest(route,{method='GET',body={}}={}) {
  const url=new URL(route,'http://demo'),parts=url.pathname.split('/').filter(Boolean);
  if(route==='/api/dashboard')return clone(data);
  if(url.pathname==='/api/library/delete'&&method==='POST'){
    const ids=new Set(body.ids);
    data.jobFiles=[...(data.jobFiles||[]),...data.library.filter(f=>ids.has(f.id))];
    data.library=data.library.filter(f=>!ids.has(f.id));
    return {deletedIds:[...ids]};
  }
  if(parts[1]==='spools') {
    if(parts.length===2&&method==='POST') {const s={...body,id:id(),remainingGrams:body.remainingGrams??body.grossGrams-body.tareGrams,reservedGrams:0,lowGrams:body.lowGrams??100,alerts:[],mount:null,archived:false,balanceIsEstimate:body.basis==='estimated'};data.inventory.spools.push(s);recalc();return {spool:clone(s)};}
    const s=data.inventory.spools.find(s=>s.id===parts[2]);if(!s)throw new Error('Rollo no encontrado en la demo.');
    if(parts[3]==='adjust'){const weight=body.remainingGrams??body.grossGrams-body.tareGrams;(ledger[s.id]??=[]).unshift({kind:'reconciliation',amountMg:(weight-s.remainingGrams)*1000,at:new Date().toISOString(),reason:body.reason});s.remainingGrams=weight;s.balanceIsEstimate=body.basis==='estimated';recalc();return {spool:clone(s)};}
    if(parts[3]==='edit'){Object.assign(s,body);return {spool:clone(s)};}
    if(parts[3]==='ledger')return {movements:ledger[s.id]||[{kind:'opening',amountMg:s.remainingGrams*1000,basis:'estimated',at:today}]};
  }
  if(parts[1]==='library'&&method==='POST'){const f={...clone(files[0]),id:id(),name:url.searchParams.get('name')||'Archivo de ejemplo',createdAt:new Date().toISOString()};data.library.unshift(f);return {file:f};}
  if(route==='/api/inventory/policy'){data.inventory.policy=body;return body;}
  if(route==='/api/printers'&&method==='POST')throw new Error('La vinculación se realiza en tu taller real. Sal de la vista de ejemplo para agregar una impresora.');
  const printer=data.printers.find(p=>p.id===parts[2]),q=data.queues.find(q=>q.printerId===parts[2]);
  if(!printer||!q)throw new Error('Esta acción no está disponible en la vista de ejemplo.');
  if(parts[3]==='queue') {
    if(parts.length===4&&method==='POST') {const f=data.library.find(f=>f.id===body.libraryId);for(let i=0;i<body.repetitions;i++)q.pending.push({id:id(),rootId:id(),printerId:printer.id,libraryId:f.id,plate:body.plate,pieces:body.piecesPerPlate,label:body.label||f.name,state:'queued',settings:body.settings,materialPlan:{state:'ready',issues:[]}});return {jobs:clone(q.pending)};}
    if(parts[4]==='reorder'){q.pending=body.jobIds.map(id=>q.pending.find(j=>j.id===id));return clone(q);}
    if(parts[4]==='dispatch') {
      if(q.active)throw new Error('Primero recolecta la placa actual.');const j=q.pending.shift();if(!j)throw new Error('La cola está vacía.');
      printer.telemetry.status='printing';printer.telemetry.progress=1;printer.telemetry.remainingMinutes=120;
      q.active={job:j,attempt:{id:id(),jobId:j.id,printerId:printer.id,state:'printing',allocations:[...data.library,...(data.jobFiles||[])].find(f=>f.id===j.libraryId).plates[0].filaments.map(f=>({filamentId:f.id,plannedMg:f.grams*1000}))},startOperation:{status:'confirmed',packet:{print:{subtask_name:printer.telemetry.currentJob.name}}}};return clone(q.active);
    }
    const job=q.pending.find(j=>j.id===parts[4])||q.history.find(j=>j.id===parts[4]);
    if(!job)throw new Error('Trabajo no encontrado.');
    if(parts[5]==='cancel'){q.pending=q.pending.filter(j=>j.id!==job.id);return {job};}
    if(parts[5]==='edit'){Object.assign(job,body);return {job};}
    if(parts[5]==='retry'){const retry={...clone(job),id:id(),state:'queued',collection:undefined,materialPlan:{state:'ready',issues:[]}};q.pending.push(retry);return {job:retry};}
    return {job,attempts:[]};
  }
  if(parts[3]==='attempts'&&q.active) {
    const a=q.active;
    if(parts[5]==='operator-collect') {
      const failed=a.attempt.outcome==='failed'||a.attempt.failureRequested;
      const collection={good:failed?0:a.job.pieces,rejected:failed?a.job.pieces:0,outcome:failed?'failed':'finished',bedCleared:true,at:new Date().toISOString()};
      const collected={...a.job,state:'collected',attemptId:a.attempt.id,collection};
      if(body.retry){const retry={...clone(a.job),id:id(),retryOf:a.job.id,state:'queued',materialPlan:{state:'ready',issues:[]}};q.pending.unshift(retry);collected.retryJobId=retry.id;}
      q.history.unshift(collected);q.counts.good+=collection.good;q.counts.rejected+=collection.rejected;
      q.active=null;printer.telemetry.status='idle';printer.telemetry.progress=0;
      return {job:clone(collected),collection};
    }
    if(parts[5]==='fail') {a.attempt.state='awaiting_collection';a.attempt.outcome='failed';a.attempt.failureRequested=true;printer.telemetry.status='failed';const f=[...data.library,...(data.jobFiles||[])].find(f=>f.id===a.job.libraryId);a.materialUsage={status:'settled',method:'progress-estimate',totalGrams:Math.round(f.plates[0].filaments.reduce((n,f)=>n+f.grams,0)*printer.telemetry.progress)/100};return clone(a);}
    if(parts[5]==='collect') {q.history.unshift({...a.job,state:'collected',attemptId:a.attempt.id,collection:{...body,at:new Date().toISOString()}});q.counts.good+=body.good;q.counts.rejected+=body.rejected;q.active=null;printer.telemetry.status='idle';printer.telemetry.progress=0;return {collection:body};}
  }
  if(parts[3]==='commands'){printer.telemetry.status=parts[4]==='pause'?'paused':'printing';if(q.active)q.active.attempt.state=printer.telemetry.status;return {operation:{status:'confirmed'}};}
  if(parts[3]==='materials'){const s=data.inventory.spools.find(s=>s.id===body.spoolId);if(s){s.mount={printerId:printer.id,...body};}return {mounts:data.inventory.spools.filter(s=>s.mount?.printerId===printer.id).map(s=>({...s.mount,spoolId:s.id}))};}
  if(parts[3]==='operations')return {operations:[]};
  throw new Error('Esta acción se revisará con los datos de tu taller.');
}
