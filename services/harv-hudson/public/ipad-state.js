import {t as uiText,ht,locale,translateMessage,languageSelector} from './i18n.js';
const stopped=status=>['idle','finished','failed'].includes(status);
const running=status=>['preparing','printing','paused'].includes(status);
const matchesJob=(active,t)=>{
  const packet=active?.startOperation?.packet?.print;
  return !!packet&&!!((packet.subtask_name&&t.currentJob?.name===packet.subtask_name)||(packet.file&&(t.currentJob?.file?.split('/').at(-1)===packet.file||t.currentJob?.name===packet.file)));
};
const colorName=color=>({'FFFFFF':uiText('blanco'),'000000':uiText('negro'),'808080':uiText('gris'),'FF0000':uiText('rojo'),'0000FF':uiText('azul'),'00FF00':uiText('verde'),'FFFF00':uiText('amarillo')})[String(color||'').replace('#','').slice(0,6).toUpperCase()];
const colorHex=color=>{const value=String(color||'').replace(/^#/,'');return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)&&!(value.length===8&&value.slice(6)==='00')?`#${value.slice(0,6).toUpperCase()}`:null;};
const filamentLabel=f=>f?[f.material||uiText('Material sin registrar'),f.color?(colorName(colorHex(f.color))||colorHex(f.color)||uiText('Color sin registrar')):null].filter(Boolean).join(' '):uiText('Sin rollo confirmado');
export function filamentAlert(plan,esc) {
  if(plan?.enforceFilamentChecks===false)return '';
  const issues=plan?.issues||[],warnings=plan?.warnings||[];
  if(!issues.length&&!warnings.length)return '';
  const row=(label,f)=>`<div class="filament-alert-line"><span>${label}</span><strong>${colorHex(f?.color)?`<i class="filament-alert-color" style="background:${colorHex(f.color)}" aria-hidden="true"></i>`:''}${esc(filamentLabel(f))}</strong></div>`;
  const entries=[...issues.map(i=>({...i,blocking:true})),...warnings.map(i=>({...i,blocking:false}))];
  return ht`<div class="filament-alerts" aria-label="Avisos de filamento"><p class="filament-alert-caption">Antes del próximo Start</p>${entries.map(i=>{
    const expected=i.expected||(i.material?{material:i.material,color:i.color}:null),source=i.source;
    const location=source?.source==='ams'?ht`AMS ${source.amsId<128?source.amsId+1:source.amsId} · Posición ${source.slotId+1}`:source?uiText('Rollo externo'):'';
    if(i.code==='FILAMENT_CHANGE_REQUIRED')return ht`<section class="filament-alert is-warning"><h4>Cambio de filamento pendiente</h4>${location?`<p class="filament-alert-location">${esc(location)}</p>`:''}${row(uiText('Para este trabajo'),i.expected)}<p>Bobina: <strong>${esc(i.target?.name)}</strong></p>${row(uiText('Cargado ahora'),i.loaded)}<p class="filament-alert-message">${esc(translateMessage(i.message))}</p></section>`;
    const title=['COLOR_MISMATCH','MATERIAL_MISMATCH','PRINTER_MATERIAL_MISMATCH'].includes(i.code)?uiText('Filamento distinto'):i.code==='STOCK_REVIEW'?uiText('Actualizar saldo de la bobina'):i.code==='INSUFFICIENT_FILAMENT'?uiText('No alcanza el filamento'):i.code==='PRINTER_COLOR_CONFLICT'?uiText('Revisar color configurado'):uiText('Revisar filamento');
    return `<section class="filament-alert ${i.blocking?'is-blocking':'is-warning'}"><h4>${title}</h4>${location?`<p class="filament-alert-location">${esc(location)}</p>`:''}${expected?row(uiText('Archivo'),expected):''}${Object.hasOwn(i,'loaded')?row(uiText('En Hudson'),i.loaded):''}${i.loaded?.name?ht`<p class="filament-alert-spool">Rollo: ${esc(i.loaded.name)}</p>`:''}${i.reported?row(uiText('En impresora'),i.reported):''}<p class="filament-alert-message">${esc(i.code==='STOCK_REVIEW'?uiText('Falta revisar cuántos gramos quedan. Abre Filamento o Inventario y pulsa Actualizar saldo en esta bobina.'):translateMessage(i.message)||uiText('El encargado debe revisar el filamento.'))}</p><p class="filament-alert-help">${i.blocking?uiText('Start bloqueado. Pide apoyo al encargado.'):uiText('Compara el rollo físico y corrige su registro o la configuración de la impresora.')}</p></section>`;
  }).join('')}</div>`;
}
function materialHint(job) {
  const issue=job?.materialPlan?.issues?.[0];
  if(!issue)return uiText('El encargado debe preparar el material.');
  if(issue.code==='FILAMENT_CHANGE_REQUIRED')return ht`Por favor, cambia a ${issue.target?.name||uiText('la bobina indicada')} y confirma el cambio.`;
  const material=[issue.expected?.material||issue.material,colorName(issue.expected?.color||issue.color)].filter(Boolean).join(' ');
  if(['COLOR_MISMATCH','MATERIAL_MISMATCH','PRINTER_MATERIAL_MISMATCH'].includes(issue.code))return ht`La cola pide ${material||uiText('otro filamento')}. El encargado debe asignarlo.`;
  if(issue.code==='STOCK_REVIEW')return uiText('Actualiza el saldo de la bobina en Inventario antes de iniciar.');
  if(issue.code==='INSUFFICIENT_FILAMENT')return uiText('No alcanza el filamento. Pide otro rollo al encargado.');
  return uiText('Falta preparar el filamento. Pide apoyo al encargado.');
}
export function operatorState(printer,queue,connected=true) {
  const t=printer.telemetry||{},a=queue?.active,attempt=a?.attempt;
  const failed=!!(attempt?.failureRequested||attempt?.outcome==='failed');
  const matched=matchesJob(a,t);
  const clearedAfterStop=failed&&attempt?.failureRequested&&a?.stopOperation?.status==='confirmed'&&!t.currentJob?.name&&!t.currentJob?.file;
  const pending=[a?.startOperation,a?.stopOperation].some(op=>op&&['dispatching','sent','acknowledged','uncertain'].includes(op.status));
  const online=connected&&!printer.unlinked&&t.fresh;
  const collection=online&&attempt?.state==='awaiting_collection'&&stopped(t.status)&&
    (a?.operatorCollection?a.operatorCollection.available:matched||clearedAfterStop)&&!pending&&(printer.enforceFilamentChecks===false||a?.materialUsage?.status!=='needs_review');
  const canFail=!!(online&&a&&(collection||(!failed&&matched&&attempt.state!=='review'&&!pending&&(running(t.status)||stopped(t.status)))));
  const canPrint=!!(collection&&!failed);
  const head=queue?.pending?.[0];
  const canStart=!!(online&&!a&&head&&stopped(t.status)&&!t.errors?.printError&&head.materialPlan?.state==='ready');
  const canRecover=!!(online&&a?.recovery?.available&&attempt?.state==='review'&&stopped(t.status)&&!matched&&!attempt.observedStartedAt);
  let label=uiText('Sin trabajos'),hint=uiText('El encargado prepara la cola.'),tone='idle';
  if(printer.unlinked){label=uiText('Sin conectar');hint=uiText('El encargado conectará esta impresora.');tone='offline';}
  else if(!online){label=uiText('Sin conexión');hint=uiText('Espera a que vuelva la conexión.');tone='offline';}
  else if(collection){label=failed?uiText('Impresión fallida'):uiText('Retirar placa');hint=uiText('Pulsa Retirar y confirma que dejaste la base vacía.');tone=failed?'failed':'finished';}
  else if(canRecover){label=a.startOperation?.status==='rejected'?uiText('No comenzó'):uiText('Inicio sin confirmar');hint=uiText('Pulsa Revisar para repetir o seguir la cola.');tone='attention';}
  else if(attempt?.failureRequested&&attempt.state!=='review'&&a?.stopOperation?.status!=='uncertain'&&!a?.attempt?.detail?.includes('no enviado')){label=uiText('Deteniendo…');hint=uiText('Espera. Todavía no retires las piezas.');tone='waiting';}
  else if(a&&(attempt.state==='review'||a.stopOperation?.status==='uncertain'||attempt.state==='awaiting_collection'||printer.enforceFilamentChecks!==false&&a.materialUsage?.status==='needs_review'||a.attempt?.detail?.includes('no enviado'))){label=uiText('Necesita ayuda');hint=uiText('Llama al encargado para revisar esta placa.');tone='attention';}
  else if(a){label=({uploading:uiText('Enviando…'),dispatching:uiText('Iniciando…'),preparing:uiText('Preparando…'),printing:uiText('Imprimiendo…'),paused:uiText('En pausa')})[attempt.state]||uiText('Esperando…');hint=attempt.state==='paused'?uiText('Pide apoyo al encargado.'):uiText('Espera a que termine.');tone='printing';}
  else {
    // Live printer status exists independently of Hudson's production queue.
    // Observing an external print never adopts it or enables collection actions.
    [label,tone]=({printing:[uiText('Imprimiendo…'),'printing'],preparing:[uiText('Preparando…'),'printing'],paused:[uiText('En pausa'),'waiting'],finished:[uiText('Terminó'),'finished'],failed:[uiText('Impresión fallida'),'failed'],idle:[uiText('Disponible'),'idle']})[t.status]||[uiText('Estado por confirmar'),'attention'];
    hint=t.status==='idle'?uiText('Conectada · Sin trabajos en cola.'):uiText('Sin una placa pendiente de registrar en Hudson.');
    if(t.status==='unknown')hint=uiText('Esperando el estado de la impresora.');
    if(t.errors?.printError)hint=uiText('La impresora tiene un aviso. Llama al encargado.');
    else if(head&&stopped(t.status))hint=canStart?uiText('Pulsa Start para imprimir la primera.'):materialHint(head);
  }
  // Never attach a previous or unrelated print's percentage to a Hudson job.
  const progress=online&&(!a||matched)&&t.status!=='idle'&&t.status!=='unknown'&&Number.isFinite(t.progress)?Math.max(0,Math.min(100,t.progress)):null;
  const currentJobName=a?.job.label||(online&&t.status!=='idle'?(t.currentJob?.name||t.currentJob?.file?.split(/[\\/]/).at(-1)||''):'');
  return {failed,collection:!!collection,canFail,canPrint,canStart,canRecover,label,hint,tone,progress,currentJobName};
}

// Display-only planning: no queue writes, reservations, timers or printer commands.
// The five-minute gap never controls when an operator may press Start.
export function operatorSchedule(printer,queue,files=[],now=Date.now(),connected=true) {
  const t=printer.telemetry||{},active=queue?.active,a=active?.attempt,cleanupMs=5*60*1000;
  const online=connected&&!printer.unlinked&&t.fresh,matched=matchesJob(active,t);
  const endedAt=Date.parse(a?.endedAt),terminal=a?.state==='awaiting_collection';
  let cursor=now,current=null,reason='';
  const uncertain=text=>{cursor=null;reason=text;};
  if(active||running(t.status)||t.status==='finished'||t.status==='failed') {
    current={label:uiText('Término'),at:null,detail:uiText('Por confirmar'),estimated:true};
    if(terminal)current={label:a.outcome==='failed'?uiText('Se detuvo'):uiText('Terminó'),at:Number.isFinite(endedAt)?endedAt:null,detail:Number.isFinite(endedAt)?uiText('Hora registrada'):uiText('Hora no registrada'),estimated:false};
  }
  if(!online)uncertain(uiText('Sin conexión'));
  else if(t.status==='paused')uncertain(uiText('En pausa · por confirmar'));
  else if(active&&(a?.state==='review'||a?.failureRequested&&!terminal||a?.collectionConflict))uncertain(uiText('Tras revisar la placa'));
  else if(terminal&&stopped(t.status)) {
    cursor=Math.max(now,(Number.isFinite(endedAt)?endedAt:now)+cleanupMs);
  } else if(['preparing','printing'].includes(t.status)&&(!active||matched)) {
    const remaining=t.remainingMinutes;
    if(Number.isFinite(remaining)&&remaining>=0&&(remaining>0||t.progress===100)) {
      const seen=Date.parse(t.lastSeenAt||t.stateSeenAt);
      const at=Math.max(now,Math.min(now,Number.isFinite(seen)?seen:now)+remaining*60*1000);
      current={label:uiText('Término'),at,detail:uiText('Estimado'),estimated:true};cursor=at+cleanupMs;
    } else uncertain(uiText('Esperando tiempo de la impresora'));
  } else if(active)uncertain(uiText('Esperando inicio confirmado'));
  else if(!stopped(t.status))uncertain(uiText('Estado por confirmar'));
  else if(current)current={label:t.status==='failed'?uiText('Se detuvo'):uiText('Terminó'),at:null,detail:uiText('Hora no registrada'),estimated:false};
  if(current&&current.estimated&&cursor===null)current.detail=reason;
  const pending=(queue?.pending||[]).map(job=>{
    const seconds=files.find(f=>f.id===job.libraryId)?.plates?.find(p=>p.index===job.plate)?.predictedSeconds;
    const durationMs=Number.isFinite(seconds)&&seconds>0?seconds*1000:null;
    if(cursor!==null&&job.materialPlan?.state==='blocked')uncertain(uiText('Tras preparar el filamento'));
    if(cursor!==null&&durationMs===null)uncertain(uiText('Duración sin registrar'));
    const startAt=cursor,endAt=cursor===null?null:cursor+durationMs;
    const result={jobId:job.id,startAt,endAt,durationMs,reason:cursor===null?reason:''};
    if(endAt!==null)cursor=endAt+cleanupMs;
    return result;
  });
  return {current,pending,cleanupMinutes:5};
}

export function operatorClock(at,now=Date.now()) {
  if(!Number.isFinite(at))return uiText('Por confirmar');
  const date=new Date(at),today=new Date(now),tomorrow=new Date(now);
  tomorrow.setDate(tomorrow.getDate()+1);
  const day=date.toDateString()===today.toDateString()?'':date.toDateString()===tomorrow.toDateString()?uiText('Mañana · '):`${date.toLocaleDateString(locale(),{day:'numeric',month:'short'})} · `;
  return day+date.toLocaleTimeString(locale(),{hour:'numeric',minute:'2-digit',hour12:true});
}
export function operatorDuration(ms) {
  if(!Number.isFinite(ms))return uiText('Por confirmar');
  const minutes=Math.max(0,Math.ceil(ms/60000)),hours=Math.floor(minutes/60);
  return hours?`${hours} h${minutes%60?` ${minutes%60} min`:''}`:`${minutes} min`;
}
