import {t as uiText,ht,locale,translateMessage,languageSelector} from './i18n.js';
import { operatorState,filamentAlert,operatorSchedule,operatorClock,operatorDuration } from './ipad-state.js';
import { createIpadInventory,openAssignFilamentForm } from './ipad-inventory.js';
import { plannedChanges,plannedChangeSummary,plannedChangeSteps } from './planned-filament.js';

export function createIpad({state,esc,dialog,mutate,refresh,toast,openForm,repaint,readSnapshot}) {
  let flow=null,busy=false,section='printers';
  const inventory=createIpadInventory({state,esc,openForm,mutate,toast,refresh,readSnapshot});
  const data=id=>({p:state.data?.printers.find(p=>p.id===id),q:state.data?.queues.find(q=>q.printerId===id)});
  const escape=esc;
  const close=()=>{flow=null;dialog.close();};
  const errorText=error=>({MATERIAL_BLOCKED:uiText('Falta preparar el filamento. Pide apoyo al encargado.'),USAGE_REVIEW:uiText('El consumo necesita revisión. Pide apoyo al encargado.'),OPERATOR_REVIEW:uiText('Esta placa necesita revisión. Pide apoyo al encargado.'),WRONG_STATE:uiText('La impresora todavía no está lista. Espera un momento.'),NOT_ACTIVE:uiText('La placa cambió. Cierra este aviso y revisa la pantalla.'),ALREADY_COLLECTED:uiText('Esta placa ya se registró. Cierra este aviso.'),OUTCOME_CHANGED:uiText('El resultado cambió. Cierra este aviso y revisa la pantalla.'),UNRESOLVED_COMMAND:uiText('Hudson espera una confirmación. No vuelvas a iniciar la impresión.'),JOB_MISMATCH:uiText('La impresora muestra otro trabajo. Pide apoyo al encargado.')})[error.code]||(error.code?uiText('No pudimos completar este paso. Pide apoyo al encargado.'):translateMessage(error.message));
  function show(title,body,choices,backLabel=uiText('Volver')) {
    if(dialog.open)dialog.close();
    dialog.classList.remove('wide','ipad-inventory-dialog');dialog.classList.add('operator-dialog');
    dialog.innerHTML=`<form class="operator-form"><div class="operator-dialog-head"><span>HUDSON · PRINT3D</span><h2 id="dialog-title">${escape(title)}</h2></div><div class="operator-dialog-body">${body}</div><p class="form-error" role="alert"></p><div class="operator-dialog-actions">${choices.map(([label,action,kind='primary'])=>`<button type="button" class="operator-choice ${kind}" data-choice="${action}">${escape(label)}</button>`).join('')}<button type="button" class="operator-back" data-choice="close">${escape(backLabel)}</button></div></form>`;
    dialog.showModal();
    dialog.querySelector('form').addEventListener('click',async event=>{
      const choice=event.target.closest('[data-choice]');if(!choice||busy)return;
      if(choice.dataset.choice==='close'){close();return;}
      if(!dialog.querySelector('form').reportValidity())return;
      const context=flow;if(!context)return;
      busy=true;const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
      try {await submit(choice.dataset.choice,context);}
      catch(error){dialog.querySelector('.form-error').textContent=['FILAMENT_CHANGE_CHANGED','QUEUE_CHANGED','SOURCE_NOT_LOADED','COLLECTION_REQUIRED','STOCK_REVIEW','SPOOL_MOUNTED_ELSEWHERE','SPOOL_IN_USE'].includes(error.code)?translateMessage(error.message):errorText(error);}
      finally{busy=false;buttons.forEach(b=>b.disabled=false);}
    });
  }
  const jobLine=(p,q)=>`<p class="operator-dialog-printer">${escape(p.model==='X1C'?'X1':p.model)}</p><p class="operator-dialog-job">${escape(q.active?.job.label||q.pending?.[0]?.label||'')}</p>`;
  const bedCheck=()=>uiText('<label class="operator-check"><input type="checkbox" required><span>Ya retiré las piezas y los restos. La base está colocada, limpia y vacía.</span></label>');
  function changeDialog(id) {
    const {p,q}=data(id),job=q?.pending?.[0];
    if(!p||!job||!plannedChanges(job).length)return;
    flow={kind:'change',id,jobId:job.id,changeId:job.materialChange.id};
    if(q.active||!state.connected||!p.telemetry?.fresh||!['idle','finished','failed'].includes(p.telemetry.status)) {
      show(uiText('Cambio de filamento pendiente'),ht`${plannedChangeSteps(job,escape)}<p>Espera a que termine y confirma primero la placa retirada.</p>`,[]);return;
    }
    show(uiText('Cambiar filamento'),ht`${jobLine(p,q)}${plannedChangeSteps(job,escape)}<label class="operator-check"><input type="checkbox" required><span>Coloqué las bobinas indicadas en sus posiciones y completé la carga en la impresora.</span></label>`,[[uiText('Confirmar cambio'),'confirm-change']]);
  }
  function startDialog(id,title=uiText('¿Lista para imprimir?')) {
    const {p,q}=data(id);if(!p||!q)return;
    const v=operatorState(p,q,state.connected),next=q.pending?.[0];
    if(!q.active&&plannedChanges(next).length){changeDialog(id);return;}
    if(!v.canStart) {
      flow={kind:'done',id};
      const explanation=!state.connected||!p.telemetry?.fresh?uiText('Espera a que vuelva la conexión.'):q.active?uiText('La pantalla se está actualizando. Revisa el estado de la impresora.'):!next?uiText('No quedan trabajos en esta cola.'):v.hint;
      show(title,`${jobLine(p,{pending:q.pending})}<p>${escape(explanation)}</p>${!q.active&&next?filamentAlert(next.materialPlan,escape):''}`,[],uiText('Listo'));return;
    }
    flow={kind:'start',id,jobId:next.id};
    show(title,ht`${jobLine(p,{pending:q.pending})}<p>Esta es la siguiente placa. Comprueba que la base está colocada y vacía.</p><label class="operator-check"><input type="checkbox" required><span>Nadie está tocando la impresora y sigue preparada con el material indicado.</span></label>`,[[uiText('Start · Iniciar siguiente'),'start']],uiText('Ahora no'));
  }
  function collectDialog(id) {
    const {p,q}=data(id);if(!p||!q?.active)return;
    const view=operatorState(p,q,state.connected);
    if(!view.collection)return;
    flow={kind:'collect',id,attemptId:q.active.attempt.id,outcome:view.failed?'failed':'finished'};
    if(view.failed)show(uiText('Retirar impresión fallida'),ht`${jobLine(p,q)}<p>Ninguna pieza quedó bien. Retira las piezas y los restos.</p>${bedCheck()}<p class="operator-small">Si alguna pieza sí sirve, pide apoyo al encargado antes de continuar.</p>`,[[uiText('Confirmar y repetir esta placa'),'retry'],[uiText('Confirmar y seguir la cola'),'collect','secondary']]);
    else show(uiText('Confirmar placa retirada'),ht`${jobLine(p,q)}<p>Esta placa tiene ${escape(q.active.job.pieces)} piezas. Confirma que todas salieron bien.</p>${bedCheck()}<p class="operator-small">Si salió mal, vuelve y pulsa Falló.</p>`,[[uiText('Todas bien · Confirmar retirada'),'collect']]);
  }
  async function submit(choice,context) {
    const {id,attemptId}=context;
    if(context.kind==='change') {
      await mutate(`/api/printers/${id}/queue/${context.jobId}/confirm-filament`,{changeId:context.changeId,confirmed:true});
      close();await refresh();startDialog(id,uiText('Filamento confirmado'));return;
    }
    if(context.kind==='recover') {
      const skip=choice==='skip';
      await mutate(`/api/printers/${id}/attempts/${attemptId}/recover-start`,{neverStarted:true,noFilamentUsed:true,bedCleared:true,action:skip?'skip':'retry'});
      close();await refresh();startDialog(id,skip?uiText('Impresora liberada'):uiText('Trabajo listo para repetir'));return;
    }
    if(context.kind==='fail') {
      await mutate(`/api/printers/${id}/attempts/${attemptId}/fail`,{reason:'El operador marcó Failed desde IPAD.'});
      flow={kind:'wait',id,attemptId};
      show(uiText('Esperando que se detenga'),ht`<p>No retires las piezas todavía.</p><p>Esta pantalla cambiará cuando la impresora confirme que se detuvo.</p>`,[]);
      await refresh({render:false});sync();return;
    }
    if(context.kind==='collect') {
      const result=await mutate(`/api/printers/${id}/attempts/${attemptId}/operator-collect`,{outcome:context.outcome,retry:choice==='retry',bedCleared:true,printerChecked:true});
      close();await refresh();startDialog(id,result.job?.retryJobId?uiText('Lista para repetir'):uiText('Placa registrada'));return;
    }
    if(context.kind==='start') {
      const result=await mutate(`/api/printers/${id}/queue/dispatch`,{jobId:context.jobId,bedCleared:true,setupConfirmed:true});
      if(result.attempt?.state==='not_sent')throw new Error(uiText('No se pudo enviar. Pide apoyo al encargado antes de volver a intentar.'));
      close();toast(result.attempt?.state==='review'?uiText('Pide apoyo al encargado. El inicio necesita revisión.'):uiText('Inicio enviado. Espera a que la impresora comience.'),result.attempt?.state==='review');await refresh();
    }
  }
  function sync() {
    if(!dialog.open||flow?.kind!=='wait')return;
    const {p,q}=data(flow.id);if(!p||!q?.active||q.active.attempt.id!==flow.attemptId){close();return;}
    const view=operatorState(p,q,state.connected);
    if(view.collection)collectDialog(flow.id);
    else if(!state.connected||!p.telemetry?.fresh||view.tone==='attention'||q.active.stopOperation?.status==='uncertain') {
      flow={...flow,kind:'help'};
      show(uiText('Pide apoyo al encargado'),uiText('<p>No pudimos confirmar que sea seguro continuar. No retires las piezas ni vuelvas a iniciar la impresión.</p>'),[]);
    }
  }
  function action(button) {
    if(button.dataset.action==='operator-tab') {
      if(!['printers','inventory'].includes(button.dataset.section))return;
      section=button.dataset.section;repaint(`[data-action="operator-tab"][data-section="${section}"]`);return;
    }
    if(button.dataset.action==='operator-add-spool')return inventory.add();
    if(button.dataset.action==='operator-assign-filament')return openAssignFilamentForm({state,esc,openForm,mutate,toast,readSnapshot,ipad:true});
    if(button.dataset.action==='operator-delete-all-spools')return inventory.removeAll();
    if(button.dataset.action==='operator-delete-spool')return inventory.remove(button.dataset.id);
    if(button.dataset.action==='operator-weigh-spool')return inventory.weigh(button.dataset.id);
    if(button.dataset.action==='operator-filament')return inventory.change(button.dataset.id,button.dataset.source);
    if(button.dataset.action==='operator-change-filament')return changeDialog(button.dataset.id);
    const id=button.dataset.id,{p,q}=data(id);if(!p)return;
    const view=operatorState(p,q,state.connected);
    if(button.dataset.action==='operator-recover'&&view.canRecover) {
      flow={kind:'recover',id,attemptId:q.active.attempt.id};
      show(uiText('¿La impresión no comenzó?'),ht`${jobLine(p,q)}<p>Puedes repetir este trabajo o saltarlo y seguir con el siguiente.</p><label class="operator-check"><input type="checkbox" required><span>Revisé esta impresora: el trabajo no comenzó, no salió filamento y la base está colocada y vacía.</span></label><p class="operator-small">Si salió algo de filamento o tienes dudas, pulsa Volver y pide apoyo al encargado.</p>`,[[uiText('Repetir este trabajo'),'recover'],[uiText('Saltar este trabajo · Seguir cola'),'skip','secondary']]);
    } else if(button.dataset.action==='operator-failed'&&view.canFail) {
      if(view.failed&&view.collection){collectDialog(id);return;}
      flow={kind:'fail',id,attemptId:q.active.attempt.id};
      show(uiText('¿La impresión salió mal?'),ht`${jobLine(p,q)}<p>${view.collection?uiText('La marcaremos como fallida.'):uiText('Hudson detendrá esta impresión.')} Después podrás repetirla.</p>`,[[uiText('Sí, salió mal'),'fail','danger']]);
    } else if(button.dataset.action==='operator-printed'&&view.collection)collectDialog(id);
    else if(button.dataset.action==='operator-start'&&view.canStart&&q.pending[0].id===button.dataset.job) {
      startDialog(id);
    }
  }
  function render(printers) {
    const rank=['P1S','A1','X1C','X2D'];
    const now=Date.parse(state.data?.at)||Date.now(),files=[...(state.data?.library||[]),...(state.data?.jobFiles||[])];
    const canChange=(p,q,job,i)=>i===0&&!q?.active&&state.connected&&p.telemetry?.fresh&&['idle','finished','failed'].includes(p.telemetry.status)&&!p.telemetry.errors?.printError&&plannedChanges(job).length>0;
    const endLabel=finish=>finish?`<div class="operator-finish"><span>${escape(finish.label)}:</span> <strong>${escape(operatorClock(finish.at,now))}</strong><small>${finish.at!==null&&finish.estimated?ht`En ${escape(operatorDuration(finish.at-now))} · estimado`:escape(finish.detail)}</small></div>`:'';
    const queueTiming=(job,timing,waiting)=>ht`<div class="operator-queue-plan"><span class="operator-queue-turn">${waiting}<small>${timing.durationMs!==null?ht`Duración: ${escape(operatorDuration(timing.durationMs))}`:uiText('Duración por confirmar')}</small></span><span class="operator-queue-eta">Término esperado<strong>${escape(operatorClock(timing.endAt,now))}</strong><small>${timing.endAt!==null?ht`En ${escape(operatorDuration(timing.endAt-now))}`:escape(timing.reason)}</small></span></div>`;
    const heading=ht`<section class="operator-screen" aria-label="IPAD · Operación del taller"><div class="operator-heading"><div><span>PRINT3D</span><h1>IPAD</h1></div><p>${state.demo?uiText('EJEMPLO · Sin impresoras reales'):state.connected?uiText('Hudson · Tu taller'):uiText('Sin conexión · Espera un momento')}</p></div><nav class="operator-tabs" aria-label="Secciones del iPad">${[['printers',uiText('Impresoras')],['inventory',uiText('Inventario')]].map(([key,label])=>`<button type="button" data-action="operator-tab" data-section="${key}" aria-pressed="${section===key}" class="${section===key?'selected':''}">${label}</button>`).join('')}</nav>${!state.connected?uiText('<p class="operator-offline" role="alert">Sin conexión con Hudson. Los datos pueden estar desactualizados. Espera un momento para continuar.</p>'):''}`;
    const assignButton=`<button type="button" class="btn assign-open" data-action="operator-assign-filament" ${state.connected?'':'disabled'}>${uiText('Asignar filamento')}</button>`;
    const localizedHeading=heading.replace('<nav class="operator-tabs"','<div class="operator-tools"><nav class="operator-tabs"').replace('</nav>','</nav>'+assignButton+'</div>'+languageSelector());
    if(section==='inventory')return `${localizedHeading}${inventory.render()}</section>`;
    return ht`${localizedHeading}<div class="operator-grid">${[...printers].sort((a,b)=>rank.indexOf(a.model)-rank.indexOf(b.model)).map(p=>{
      const q=state.data.queues.find(q=>q.printerId===p.id),v=operatorState(p,q,state.connected),name=p.model==='X1C'?'X1':p.model;
      const schedule=operatorSchedule(p,q,files,now,state.connected);
      const recoveryAction=v.canRecover?'operator-recover':'operator-failed',recoveryLabel=v.canRecover?uiText('Revisar'):uiText('Falló');
      return ht`<article class="operator-card ${v.tone==='attention'?'operator-attention':v.tone}" aria-label="Impresora ${escape(name)}">${inventory.loaded(p,q)}<div class="operator-card-body"><h2>${escape(name)}</h2><div class="operator-progress" role="progressbar" aria-label="Progreso ${escape(name)}" aria-valuemin="0" aria-valuemax="100" ${v.progress===null?uiText('aria-valuetext="Sin progreso confirmado"'):`aria-valuenow="${v.progress}"`}><span style="width:${v.progress??0}%"></span><strong>${v.progress===null?'—':`${Math.round(v.progress)}%`}</strong></div><p class="operator-status">${escape(v.label)}</p><p class="operator-current" title="${escape(v.currentJobName)}">${escape(v.currentJobName)}</p>${endLabel(schedule.current)}<div class="operator-main-actions"><button class="operator-failed ${v.canRecover?'operator-recover':''}" data-action="${recoveryAction}" data-id="${escape(p.id)}" aria-label="${recoveryLabel} · ${escape(name)}" ${v.canFail||v.canRecover?'':'disabled'}>${recoveryLabel}</button><button class="operator-printed" data-action="operator-printed" data-id="${escape(p.id)}" aria-label="Retirar placa · ${escape(name)}" ${v.collection?'':'disabled'}>Retirar</button></div><p class="operator-hint">${escape(v.hint)}</p>${filamentAlert(q?.active?.materialPlan||q?.pending?.[0]?.materialPlan,escape)}<ol class="operator-queue" aria-label="Cola ${escape(name)}">${(q?.pending||[]).slice(0,20).map((job,i)=>`<li><span title="${escape(job.label)}">${escape(job.label)}</span><button data-action="${canChange(p,q,job,i)?'operator-change-filament':'operator-start'}" data-id="${escape(p.id)}" data-job="${escape(job.id)}" aria-label="${canChange(p,q,job,i)?uiText('Cambiar filamento'):uiText('Start')} · ${escape(name)} · ${escape(job.label)}" ${i===0&&v.canStart||canChange(p,q,job,i)?'':'disabled'}>${canChange(p,q,job,i)?uiText('Cambiar'):uiText('Start')}</button>${plannedChangeSummary(job,escape)}${queueTiming(job,schedule.pending[i],i>0||q.active?uiText('Espera su turno'):v.canStart?uiText('Siguiente impresión'):uiText('Pendiente de preparación'))}</li>`).join('')||`<li class="operator-empty">${q?.active?uiText('Sin más trabajos en cola'):uiText('Sin trabajos en cola')}</li>`}</ol>${q?.pending.length>20?ht`<p class="operator-more">${q.pending.length-20} trabajos más en la cola</p>`:''}</div></article>`;
    }).join('')}</div><p class="operator-schedule-note">Horarios estimados con 5 min de limpieza entre placas, solo para planear. Puedes iniciar antes si la base ya está lista.</p></section>`;
  }
  dialog.addEventListener('close',()=>{if(!dialog.open)flow=null;});
  return {render,action,sync,changeDialog};
}
