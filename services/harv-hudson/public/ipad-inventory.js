import {t as uiText,ht,locale,translateMessage,languageSelector} from './i18n.js';
import {spoolColors,planSpoolLabels} from './spool-labels.js';
import {filamentPositionBlock,filamentRunning} from './filament-access.js';
const materials=['PLA','PETG','ABS','TPU','PLA SILK','HVA'];
const brands=['Elegoo','Mexico Makers','Bambu Labs','China'];
const format=new Intl.NumberFormat(locale(),{maximumFractionDigits:1});
const grams=n=>format.format(Number(n)||0);
const standardTareGrams=215;

// These helpers only read inventory/telemetry. Rendering never changes mounts or jobs.
const materialKey=value=>String(value||'').trim().toUpperCase();
const colorKey=value=>String(value||'').replace(/^#/,'').slice(0,6).toUpperCase();
const sourceKey=s=>`${s.source}:${s.amsId}:${s.slotId}`;
// Group the display only: material variants and physical spool IDs stay distinct.
export function spoolMaterialGroups(spools) {
  const preferred=['PVA','PLA','ABS','PETG','TPU','PLA SILK','PLA + CF','PA612-CF15'];
  const groups=new Map();
  for(const spool of spools) {
    if(spool.archived)continue;
    const material=materialKey(spool.material).replace(/\s+/g,' ');
    if(!groups.has(material))groups.set(material,{material,spools:[]});
    groups.get(material).spools.push(spool);
  }
  const rank=material=>{const i=preferred.indexOf(material);return i<0?preferred.length:i;};
  return [...groups.values()].sort((a,b)=>rank(a.material)-rank(b.material)||a.material.localeCompare(b.material,locale(),{numeric:true}));
}
export const filamentColor=value=>{
  const hex=String(value||'').replace(/^#/,'');
  return /^[a-f0-9]{6}([a-f0-9]{2})?$/i.test(hex)&&!(hex.length===8&&hex.slice(6)==='00')?'#'+hex.slice(0,6):null;
};
export const filamentLocation=s=>s.source==='external'?ht`Externo${s.amsId===255?' 2':''}`:ht`AMS ${s.amsId+1} · Posición ${s.slotId+1}`;
export function filamentPositions(printer,spools=[]) {
  if(!printer||printer.unlinked)return [];
  const found=new Map();
  const add=(s,reported=false)=>{
    if(!['ams','external'].includes(s.source)||!Number.isInteger(s.amsId)||!Number.isInteger(s.slotId)||s.slotId<0||s.slotId>3)return;
    const key=sourceKey(s);found.set(key,{...found.get(key),source:s.source,amsId:s.amsId,slotId:s.slotId,key,...(reported?{report:s}:{})});
  };
  for(const s of printer.telemetry?.slots||[])add(s,true);
  for(const s of spools)if(!s.archived&&s.mount?.printerId===printer.id)add(s.mount);
  if((printer.model==='P1S'||printer.enforceFilamentChecks===false)&&![...found.values()].some(s=>s.source==='external'))add({source:'external',amsId:254,slotId:0});
  return [...found.values()].sort((a,b)=>(a.source===b.source?0:a.source==='ams'?-1:1)||a.amsId-b.amsId||a.slotId-b.slotId).map(s=>{
    const spool=spools.find(r=>!r.archived&&r.mount?.printerId===printer.id&&sourceKey(r.mount)===s.key);
    return {...s,spool,color:filamentColor(spool?.color)||filamentColor(s.report?.color),label:filamentLocation(s)};
  });
}
export function filamentChoices(printer,spools,filament,connected=true) {
  return filamentPositions(printer,spools).map(s=>{
    if(printer.enforceFilamentChecks===false)return {...s,reason:'',usable:true};
    let reason='';
    if(!connected||!printer.telemetry?.fresh)reason=uiText('Sin conexión confirmada');
    else if(!s.spool)reason=s.report?.empty?uiText('Posición vacía'):uiText('Registra la bobina cargada');
    else if(!s.report||s.report.empty)reason=uiText('La impresora no confirma filamento');
    else if(s.spool.stockUncertain)reason=uiText('Saldo por actualizar');
    else if(!(s.spool.remainingGrams>0))reason=uiText('Bobina sin saldo');
    else if(materialKey(s.spool.material)!==materialKey(filament.type))reason=uiText('Material distinto al archivo');
    // Keep the same compatibility policy as the existing inventory service.
    else if(s.spool.color&&filament.color&&colorKey(s.spool.color)!==colorKey(filament.color))reason=uiText('Color distinto al archivo');
    else if(materialKey(s.report.material)!==materialKey(filament.type))reason=uiText('Revisa el material en la impresora');
    else if(s.spool.mount?.observedTagUid&&s.report.tagUid&&s.spool.mount.observedTagUid!==s.report.tagUid)reason=uiText('Confirma la nueva bobina');
    return {...s,reason,usable:!reason};
  });
}
export function filamentPicker({printer,spools,filament,selected='',connected=true,esc}) {
  const choices=filamentChoices(printer,spools,filament,connected);
  const review=printer.enforceFilamentChecks===false?[]:choices.filter(s=>s.spool?.stockUncertain);
  const guidance=review.length?ht`<div class="filament-picker-empty"><strong>Actualiza el saldo de filamento</strong><p>Los gramos registrados necesitan revisión. ${review.some(s=>s.spool.uncertaintyReason?.includes('fuera del intento'))?uiText('Hubo impresiones fuera de Hudson y falta registrar su consumo.'):uiText('Revisa cuánto filamento queda en las bobinas marcadas.')} Actualiza el saldo antes de elegirlas.</p>${review.map(s=>ht`<button type="button" class="btn small" data-action="weigh" data-id="${esc(s.spool.id)}">Actualizar saldo · ${esc(s.spool.name)}</button>`).join('')}</div>`:!choices.some(s=>s.usable)?uiText('<p class="filament-picker-empty">No hay una bobina cargada compatible. Revisa el filamento en IPAD o en Filamento.</p>'):'';
  return ht`<fieldset class="filament-picker"><legend>Filamento ${esc(filament.id)} · ${esc(filament.type)} · ${grams(filament.grams)} g${filamentColor(filament.color)?ht` <i class="filament-circle filament-requested" style="--filament-color:${filamentColor(filament.color)}" aria-label="Color del archivo ${esc(filament.color)}"></i>`:''}</legend><p class="filament-picker-hint">${printer.enforceFilamentChecks===false?uiText('Elige la entrada de filamento que usará la impresora.'):uiText('Toca una bobina cargada para este filamento.')}</p><div class="filament-picker-options">${choices.map(s=>`<label class="filament-option ${s.usable?'':'is-unavailable'}"><input type="radio" name="map-${esc(filament.id)}" value="${esc(s.key)}" required ${s.usable?'':'disabled'} ${s.key===selected?'checked':''}><span class="filament-option-face"><span class="filament-circle ${s.color?'':'is-unknown'}" style="--filament-color:${s.color||'transparent'}" aria-hidden="true"></span><strong>${esc(s.spool?.name||(printer.enforceFilamentChecks===false?s.label:uiText('Sin bobina')))}</strong><span>${esc(s.label)}</span><small>${esc(s.spool?.material||s.report?.material||'')}${s.spool?` · ${grams(s.spool.remainingGrams)} g ${s.spool.stockUncertain?uiText('registrados · por revisar'):uiText('restantes')}`:''}</small>${s.reason?`<em>${esc(s.reason)}</em>`:''}<span class="filament-selected-mark" aria-hidden="true">✓</span></span></label>`).join('')}</div>${guidance}</fieldset>`;
}
export function filamentChangeReason(printer,queue,connected=true,source) {
  return uiText(filamentPositionBlock({printer,active:queue?.active?.attempt,connected,source}));
}

// Physical assignment uses registered/observed feeders, never a model-based AMS guess.
export function assignmentPositions(printer,spools=[]) {
  if(!printer||printer.unlinked)return [];
  const positions=filamentPositions(printer,spools),found=new Map(positions.map(s=>[s.key,s]));
  for(const amsId of new Set(positions.filter(s=>s.source==='ams'&&s.amsId<128).map(s=>s.amsId))){
    for(let slotId=0;slotId<4;slotId++){
      const s={source:'ams',amsId,slotId},key=sourceKey(s);
      if(!found.has(key))found.set(key,{...s,key,label:filamentLocation(s)});
    }
  }
  if(!positions.some(s=>s.source==='external')){
    const s={source:'external',amsId:254,slotId:0};found.set(sourceKey(s),{...s,key:sourceKey(s),label:filamentLocation(s)});
  }
  return [...found.values()].sort((a,b)=>(a.source===b.source?0:a.source==='ams'?-1:1)||a.amsId-b.amsId||a.slotId-b.slotId);
}
const assignmentMount=m=>m?JSON.stringify([m.printerId,m.source,m.amsId,m.slotId,m.confirmedAt||null]):null;
export function assignmentSpoolBlock(data,spool,connected=true) {
  if(!spool||spool.archived)return uiText('La bobina ya no está disponible.');
  if(data.queues?.some(q=>q.active?.attempt?.allocations?.some(a=>a.spoolId===spool.id)&&(!spool.mount||q.printerId!==spool.mount.printerId)))return uiText('Asignada a una impresión abierta');
  if(spool.mount){
    const p=data.printers?.find(p=>p.id===spool.mount.printerId),q=data.queues?.find(q=>q.printerId===spool.mount.printerId);
    return filamentChangeReason(p,q,connected,spool.mount);
  }
  return connected?'':uiText('Espera a que Hudson vuelva a conectarse.');
}
export function prepareFilamentAssignment(data,spoolId,printerId,key,connected=true) {
  const spools=data?.inventory?.spools||[],spool=spools.find(s=>s.id===spoolId&&!s.archived);
  const printer=data?.printers?.find(p=>p.id===printerId),q=data?.queues?.find(q=>q.printerId===printerId);
  const position=assignmentPositions(printer,spools).find(s=>s.key===key);
  const why=filamentChangeReason(printer,q,connected,position)||assignmentSpoolBlock(data,spool,connected);
  if(why)throw new Error(why);
  if(!position)throw new Error(uiText('Esta posición cambió. Cierra y vuelve a revisar la bobina.'));
  if(position.spool?.id===spoolId)throw new Error(uiText('Esta bobina ya está registrada aquí. Elige otra o cierra esta ventana.'));
  if(position.spool){const block=assignmentSpoolBlock(data,position.spool,connected);if(block)throw new Error(block);}
  return {spoolId,printerId,key,source:position.source,amsId:position.amsId,slotId:position.slotId,
    origin:assignmentMount(spool.mount),destination:assignmentMount(position.spool?.mount),previousSpoolId:position.spool?.id||null};
}
export async function confirmFilamentAssignment({state,proposal,confirmed,readSnapshot,mutate}) {
  if(!confirmed)throw new Error(uiText('Confirma primero el cambio físico de la bobina.'));
  if(!proposal)throw new Error(uiText('Selecciona una bobina y su posición.'));
  if(!state.connected)throw new Error(uiText('Espera a que Hudson vuelva a conectarse.'));
  const data=await readSnapshot();
  const current=prepareFilamentAssignment(data,proposal.spoolId,proposal.printerId,proposal.key,state.connected);
  if(current.origin!==proposal.origin||current.destination!==proposal.destination||current.previousSpoolId!==proposal.previousSpoolId)
    throw new Error(uiText('La asignación cambió en otro dispositivo. Vuelve a las posiciones y revísala.'));
  const {spoolId,source,amsId,slotId}=current;
  return mutate(`/api/printers/${current.printerId}/materials`,{spoolId,source,amsId,slotId,confirmed:true});
}

export async function openAssignFilamentForm({state,esc,openForm,mutate,toast,readSnapshot,ipad=false,selectedId=''}) {
  if(!state.connected){toast(uiText('Espera a que Hudson vuelva a conectarse.'),true);return;}
  const data=await readSnapshot(),spools=(data.inventory?.spools||[]).filter(s=>!s.archived).sort((a,b)=>a.name.localeCompare(b.name,locale(),{numeric:true}));
  const printers=(data.printers||[]).filter(p=>!p.unlinked);
  let selected=spools.some(s=>s.id===selectedId)?selectedId:'',proposal=null;
  const location=s=>{
    const p=printers.find(p=>p.id===s?.mount?.printerId);
    return s?.mount?`${p?.name||p?.model||uiText('Impresora')} · ${filamentLocation(s.mount)}`:uiText('En inventario · Sin asignar');
  };
  const circle=color=>`<span class="assign-swatch ${filamentColor(color)?'':'unknown'}" style="--filament-color:${filamentColor(color)||'transparent'}" aria-hidden="true"></span>`;
  const spoolCards=spools.map(s=>{
    const block=assignmentSpoolBlock(data,s,state.connected);
    const colorName=spoolColors.find(([hex])=>hex.toUpperCase()===s.color?.slice(0,7).toUpperCase())?.[1]||'';
    return `<button type="button" class="assign-spool" data-assign-spool="${esc(s.id)}" data-search="${esc(`${s.name} ${s.material} ${s.brand||''} ${uiText(colorName)}`.toLocaleLowerCase(locale()))}" aria-pressed="false" ${block?'disabled':''}>${circle(s.color)}<span class="assign-copy"><strong>${esc(s.name)}</strong><small>${esc(s.material)} · ${grams(s.remainingGrams)} g</small><small>${esc(location(s))}</small>${block?`<small class="assign-block">${esc(block)}</small>`:''}</span><span data-assign-drag class="assign-drag-handle" aria-hidden="true" title="${esc(uiText('Arrastrar bobina'))}">⠿</span></button>`;
  }).join('');
  const printerCards=printers.map(p=>{
    const q=data.queues?.find(q=>q.printerId===p.id),reason=filamentChangeReason(p,q,state.connected),positions=assignmentPositions(p,spools);
    const groups=[...new Set(positions.map(s=>s.source==='ams'?`ams:${s.amsId}`:'external'))];
    return `<article class="assign-printer"><h3>${esc(p.model==='X1C'?'X1 Carbon':p.model)} <small>${esc(p.name)}</small></h3>${reason?`<p class="assign-block">${esc(reason)}</p>`:''}${groups.map(group=>{
      const slots=positions.filter(s=>(s.source==='ams'?`ams:${s.amsId}`:'external')===group);
      return `<section class="assign-feeder"><h4>${group==='external'?uiText('Entradas externas'):esc(`AMS ${slots[0].amsId+1}`)}</h4><div class="assign-slots ${group==='external'?'external':''}">${slots.map(s=>{
        const block=filamentChangeReason(p,q,state.connected,s)||(s.spool?assignmentSpoolBlock(data,s.spool,state.connected):'');
        const inUse=filamentRunning(p.telemetry)&&[...(p.telemetry.filamentUse?.current||[]),...(p.telemetry.filamentUse?.target||[])].includes(s.key);
        return `<button type="button" class="assign-slot" data-assign-slot="${esc(s.key)}" data-assign-printer="${esc(p.id)}" title="${esc(block)}" aria-label="${esc(`${p.name||p.model} · ${s.label} · ${s.spool?.name||uiText('Sin bobina registrada')}${block?' · '+block:''}`)}" ${block?'disabled':''}>${circle(s.spool?.color||s.color)}<b>${s.source==='external'?(s.amsId===255?'E2':'E'):s.slotId+1}</b><span>${esc(s.spool?.name||(s.report&&!s.report.empty?uiText('Sin registrar'):uiText('Vacío')))}</span>${inUse?`<small>${uiText('En uso')}</small>`:''}</button>`;
      }).join('')}</div></section>`;
    }).join('')}</article>`;
  }).join('');
  const body=`<div class="assign-board" data-assign-board><p class="assign-instruction" role="status" data-assign-status>${uiText('Arrastra una bobina a su posición, o toca la bobina y después la posición.')}</p><div class="assign-layout"><section class="assign-inventory"><h3>${uiText('Tus bobinas')}</h3><label class="field"><span class="sr-only">${uiText('Buscar bobina, color o material')}</span><input type="search" data-assign-search placeholder="${esc(uiText('Buscar bobina, color o material'))}"></label><div class="assign-spools">${spoolCards}</div><p class="muted" data-assign-empty ${spools.length?'hidden':''}>${uiText('No hay bobinas para mostrar. Agrega bobinas en Inventario o cambia la búsqueda.')}</p></section><section class="assign-printers"><h3>${uiText('Elige la posición')}</h3><div class="assign-printer-grid">${printerCards||`<p>${uiText('Primero vincula una impresora desde Ajustes.')}</p>`}</div></section></div></div><section data-assign-confirm hidden><button type="button" class="btn" data-assign-back>← ${uiText('Volver a posiciones')}</button><div data-assign-summary></div><label class="operator-check assign-check"><input type="checkbox" name="confirmed" required disabled><span>${uiText('Ya coloqué esta bobina en la posición indicada.')}</span></label><p class="muted">${uiText('Esto registra el cambio físico. No carga filamento ni inicia una impresión.')}</p></section>`;
  const reopen=()=>openAssignFilamentForm({state,esc,openForm,mutate,toast,readSnapshot,ipad}).catch(e=>toast(translateMessage(e.message),true));
  openForm(uiText('Asignar filamento'),body,async values=>{
    await confirmFilamentAssignment({state,proposal,confirmed:values.confirmed,readSnapshot,mutate});
    toast(uiText('Asignación guardada. La bobina ya aparece en su posición.'));
  },{wide:true,dialogClass:'assign-filament-dialog',submit:uiText('Confirmar cambio'),onSuccess:reopen,after:form=>{
    const board=form.querySelector('[data-assign-board]'),confirm=form.querySelector('[data-assign-confirm]'),checkbox=form.elements.namedItem('confirmed'),submit=form.querySelector('[type="submit"]');
    submit.hidden=true;
    const status=form.querySelector('[data-assign-status]'),cards=[...form.querySelectorAll('[data-assign-spool]')];
    const markSelected=()=>{
      if(selected&&assignmentSpoolBlock(data,spools.find(s=>s.id===selected),state.connected))selected='';
      for(const card of cards)card.setAttribute('aria-pressed',String(card.dataset.assignSpool===selected));
      const s=spools.find(s=>s.id===selected);
      status.textContent=s?ht`Seleccionada: ${s.name}. Toca su posición en la impresora.`:uiText('Arrastra una bobina a su posición, o toca la bobina y después la posición.');
    };
    markSelected();
    const choose=button=>{
      try{
        if(!selected){status.textContent=uiText('Selecciona una bobina y su posición.');return;}
        proposal=prepareFilamentAssignment(data,selected,button.dataset.assignPrinter,button.dataset.assignSlot,state.connected);
        const s=spools.find(s=>s.id===selected),p=printers.find(p=>p.id===proposal.printerId),out=spools.find(s=>s.id===proposal.previousSpoolId);
        form.querySelector('[data-assign-summary]').innerHTML=`<div class="assign-confirm-card">${circle(s.color)}<div><h3>${esc(s.name)}</h3><p>${esc(s.material)} · ${grams(s.remainingGrams)} g</p><strong>${esc(p.name||p.model)} · ${esc(filamentLocation(proposal))}</strong></div></div>${s.mount?`<p>${esc(ht`Se retira de: ${location(s)}.`)}</p>`:''}${out?`<p>${esc(ht`${out.name} volverá al inventario sin asignar. Conserva su etiqueta y su saldo.`)}</p>`:''}`;
        if(data.queues?.find(q=>q.printerId===p.id)?.active?.attempt?.allocations?.some(a=>a.sourceKey===proposal.key))
          form.querySelector('[data-assign-summary]').innerHTML+=`<p class="notice">${uiText('Esta placa puede volver a usar esta posición. Coloca el material y color que necesita.')}</p>`;
        board.hidden=true;confirm.hidden=false;checkbox.disabled=false;checkbox.checked=false;submit.hidden=false;submit.disabled=true;
        form.querySelector('.form-error')?.replaceChildren();checkbox.focus();
      }catch(error){status.textContent=translateMessage(error.message);}
    };
    checkbox.addEventListener('change',()=>{submit.disabled=!checkbox.checked;});
    form.querySelector('[data-assign-back]').addEventListener('click',reopen);
    form.querySelector('[data-assign-search]').addEventListener('input',event=>{
      const query=event.target.value.trim().toLocaleLowerCase(locale());let count=0;
      for(const card of cards){card.hidden=!card.dataset.search.includes(query);if(!card.hidden)count++;}
      form.querySelector('[data-assign-empty]').hidden=count>0;
    });
    let drag=null,ghost=null,hover=null,suppressClick=false;
    const cleanup=()=>{ghost?.remove();hover?.classList.remove('drop-hover');ghost=null;hover=null;drag=null;};
    form.addEventListener('click',event=>{
      if(suppressClick){event.preventDefault();return;}
      const card=event.target.closest('[data-assign-spool]'),slot=event.target.closest('[data-assign-slot]');
      if(card&&!card.disabled){selected=card.dataset.assignSpool;markSelected();}
      else if(slot&&!slot.disabled)choose(slot);
    });
    form.addEventListener('pointerdown',event=>{
      const card=event.target.closest('[data-assign-spool]');
      if(!card||card.disabled||event.button!==0||event.isPrimary===false||(event.pointerType!=='mouse'&&!event.target.closest('[data-assign-drag]')))return;
      drag={card,id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};card.setPointerCapture(event.pointerId);
    });
    form.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<8)return;
      event.preventDefault();drag.moved=true;selected=drag.card.dataset.assignSpool;markSelected();
      if(!selected){cleanup();return;}
      if(!ghost){ghost=form.ownerDocument.createElement('div');ghost.className='assign-drag-ghost';ghost.textContent=spools.find(s=>s.id===selected).name;form.append(ghost);}
      ghost.style.left=`${event.clientX+12}px`;ghost.style.top=`${event.clientY+12}px`;
      const slot=form.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest('[data-assign-slot]');
      hover?.classList.remove('drop-hover');hover=slot&&!slot.disabled?slot:null;hover?.classList.add('drop-hover');
    });
    form.addEventListener('pointerup',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const moved=drag.moved,target=hover;cleanup();
      if(moved){event.preventDefault();suppressClick=true;setTimeout(()=>{suppressClick=false;},0);if(target)choose(target);}
    });
    form.addEventListener('pointercancel',cleanup);
    form.closest('dialog')?.addEventListener('close',cleanup,{once:true});
  }});
}

// Weight reconciliation uses the same guards as the inventory service. Guide
// the operator to collection first; never close an attempt just to clear stock.
function weightBlock(state,spool) {
  const q=state.data?.queues?.find(q=>q.active?.attempt?.allocations?.some(l=>l.spoolId===spool.id));
  const printer=state.data?.printers?.find(p=>p.id===(q?.printerId||spool.mount?.printerId));
  const stopped=state.connected&&printer?.telemetry?.fresh&&['idle','finished','failed'].includes(printer.telemetry.status);
  if(spool.archived)return {message:uiText('Esta bobina está archivada.')};
  if(q)return {queue:q,printer,stopped,message:stopped?uiText('Primero confirma la placa anterior. Su consumo debe quedar registrado antes de actualizar el saldo.'):uiText('Espera a que termine la impresión y confirma la placa retirada antes de actualizar el saldo.')};
  if(spool.mount&&!stopped)return {message:uiText('Espera a que la impresora esté detenida y conectada antes de actualizar el saldo.')};
  return null;
}

// PC and iPad share registration, label preview, and weight reconciliation.
export function openSpoolForm(options) {
  const {state,esc,openForm,mutate,toast,spool,ipad=false}=options;
  if(!state.connected){toast(uiText('Espera a que Hudson vuelva a conectarse.'),true);return;}
  if(!spool)return openBatchSpoolForm(options);
  const blocked=weightBlock(state,spool);
  if(blocked) {
    const q=blocked.queue,canCollect=q&&blocked.stopped&&(!ipad||q.active.operatorCollection?.available);
    const link=canCollect?ht`<button type="button" class="btn primary" data-action="${ipad?'operator-printed':'collect'}" data-id="${esc(q.printerId)}">Revisar placa anterior</button>`:'';
    openForm(uiText('Actualizar saldo'),ht`<div class="summary-box"><strong>${esc(spool.name)}</strong><p>${grams(spool.remainingGrams)} g registrados · ${esc(spool.material)}</p></div><div class="notice"><p>${esc(blocked.message)}</p>${q?ht`<p>Placa pendiente: <strong>${esc(q.active.job?.label||uiText('Impresión anterior'))}</strong></p>`:''}${ipad&&q&&!canCollect?uiText('<p>Pide al encargado que revise esta placa en Producción de Hudson.</p>'):''}${link}</div><p>Después vuelve a Actualizar saldo e indica los gramos que quedan en la bobina.</p>`,()=>{},{hideSubmit:true,dialogClass:ipad?'ipad-inventory-dialog':''});return;
  }
  const reviewing=!!spool.stockUncertain;
  const notice=reviewing?ht`<div class="notice"><strong>Consumo por registrar</strong><p>${esc(spool.uncertaintyReason||uiText('El saldo necesita revisión.'))}</p><p>El saldo anterior puede ser mayor que lo que queda. Escribe el peso actual o una estimación que incluya las impresiones hechas fuera de Hudson.</p></div>`:'';
  const check=reviewing?uiText('<label class="check"><input type="checkbox" name="stockReviewed" required><span>Revisé la bobina y los gramos indicados son los que quedan ahora.</span></label>'):'';
  const body=ht`<div class="summary-box"><strong>${esc(spool.name)}</strong><p>${grams(spool.remainingGrams)} g registrados · ${esc(spool.material)}</p></div>${notice}`+
    `<label class="field"><span>${uiText('Peso del filamento (g)')}</span><input name="remainingGrams" type="number" value="${reviewing?'':esc(spool.remainingGrams)}" inputmode="decimal" min="0" max="100000" step="0.001" required><small>${uiText('Gramos que quedan, sin incluir el carrete.')}</small></label>${check}`+
    `<details class="ipad-spool-options"><summary>${uiText('Más opciones')}</summary><label class="field"><span>${uiText('Nota del ajuste · opcional')}</span><input name="reason" maxlength="500"></label></details>`;
  openForm(reviewing?uiText('Actualizar saldo'):uiText('Actualizar peso'),body,async v=>{
    if(!state.connected)throw new Error(uiText('Sin conexión con Hudson. Espera un momento antes de guardar.'));
    const latest=state.data?.inventory?.spools?.find(s=>s.id===spool.id)||spool,block=weightBlock(state,latest);if(block)throw new Error(block.message);
    if(reviewing&&!v.stockReviewed)throw new Error(uiText('Confirma que revisaste cuántos gramos quedan ahora.'));
    await mutate(`/api/spools/${spool.id}/adjust`,{remainingGrams:spoolWeight(v.remainingGrams),basis:'estimated',reason:String(v.reason||'').trim()||(reviewing?uiText('Saldo revisado después de consumo sin contabilizar.'):uiText('Actualización manual del peso de filamento.'))});
    toast(reviewing?uiText('Saldo actualizado. Ya puedes volver a elegir esta bobina.'):uiText('Peso actualizado. El historial se conservó.'));
  },{subtitle:uiText('Indica cuántos gramos de filamento quedan.'),submit:reviewing?uiText('Confirmar saldo'):uiText('Actualizar peso'),dialogClass:ipad?'ipad-inventory-dialog':''});
}
const spoolWeight=value=>{
  const n=Number(value);
  if(String(value??'').trim()===''||!Number.isFinite(n)||n<0||n>100000)throw new Error(uiText('Escribe entre 0 y 100,000 gramos por bobina.'));
  return n;
};
export function spoolBatchPayload(v) {
  const text=value=>String(value??'').trim();
  const material=text(v.material==='other'?v.customMaterial:v.material).toUpperCase();
  const brand=text(v.brand==='other'?v.customBrand:v.brand);
  const color=text(v.color==='other'?v.customColor:v.color).toUpperCase();
  const quantity=Number(v.quantity??1);
  if(!/^[A-Z0-9 _+.-]{2,40}$/.test(material))throw new Error(uiText('Selecciona o escribe el material.'));
  if(!brand||brand.length>80)throw new Error(uiText('Selecciona o escribe la marca.'));
  if(!/^#[A-F0-9]{6}$/.test(color))throw new Error(uiText('Selecciona un color para la bobina.'));
  if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new Error(uiText('Indica entre 1 y 100 bobinas.'));
  if(v.fillState==='partial'){
    const grossGrams=spoolWeight(v.grossGrams),tareGrams=spoolWeight(v.tareGrams??standardTareGrams);
    if(grossGrams<tareGrams)throw new Error(uiText('El peso de la báscula no puede ser menor que el de la bobina vacía.'));
    return {material,brand,color,quantity,grossGrams,tareGrams,basis:'estimated',lowGrams:spoolWeight(v.lowGrams??100)};
  }
  const remainingGrams=v.fillState==='empty'?0:spoolWeight(v.remainingGrams);
  if(v.fillState==='full'&&remainingGrams===0)throw new Error(uiText('Para registrar 0 gramos, selecciona Vacías.'));
  return {material,brand,color,quantity,remainingGrams,basis:'estimated',lowGrams:spoolWeight(v.lowGrams??100)};
}
function spoolTags(spools,esc) {
  return `<ul class="spool-batch-labels">${spools.map(s=>`<li><strong>${esc(s.name)}</strong><small>${esc(s.material)} · ${grams(s.remainingGrams)} g</small></li>`).join('')}</ul>`;
}
function openBatchSpoolForm({state,esc,openForm,mutate,toast,ipad=false}) {
  const list=(defaults,key)=>{
    const values=[...defaults],seen=new Set(defaults.map(v=>v.toUpperCase()));
    for(const s of state.data?.inventory?.spools||[]) {
      const value=String(s[key]||'').trim(),normalized=value.toUpperCase();
      if(value&&!s.archived&&!seen.has(normalized)&&!(key==='brand'&&normalized==='BAMBU LAB')){values.push(value);seen.add(normalized);}
    }
    return values.map(v=>[v,v]);
  };
  const choose=(label,name,items)=>`<label class="field"><span>${esc(label)}</span><select name="${name}" required>${items.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label>`;
  const field=(label,name,{type='text',value='',extra='',hint=''}={})=>`<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" required ${extra}>${hint?`<small>${esc(hint)}</small>`:''}</label>`;
  const body=`<div class="form-grid">
    ${choose('Material','material',[['',uiText('Selecciona un material')],...list(materials,'material'),['other',uiText('Otro material…')]])}
    ${choose(uiText('Marca'),'brand',[['',uiText('Selecciona una marca')],...list(brands,'brand'),['other',uiText('Otra marca…')]])}
    <div class="full" data-spool-custom="material" hidden>${field(uiText('Escribe el material'),'customMaterial',{extra:'disabled maxlength="40" pattern="[A-Za-z0-9 _+.\\-]{2,40}"'})}</div>
    <div class="full" data-spool-custom="brand" hidden>${field(uiText('Escribe la marca'),'customBrand',{extra:'disabled maxlength="80"'})}</div>
    ${choose('Color','color',[['',uiText('Selecciona un color')],...spoolColors.map(([hex,label])=>[hex,uiText(label)]),['other',uiText('Otro color…')]])}
    ${field(uiText('Cantidad de bobinas'),'quantity',{type:'number',value:1,extra:'inputmode="numeric" min="1" max="100" step="1"'})}
    <div class="full" data-spool-custom="color" hidden>${field(uiText('Elige el color'),'customColor',{type:'color',value:'#FFFFFF',extra:'disabled'})}</div>
    ${choose(uiText('Estado de las bobinas'),'fillState',[['full',uiText('Nuevas y llenas')],['partial',uiText('Empezadas')],['empty',uiText('Vacías')]])}
    <div data-spool-net>${field(uiText('Gramos por bobina'),'remainingGrams',{type:'number',value:1000,extra:'inputmode="decimal" min="0" max="100000" step="0.001"',hint:uiText('Solo filamento, sin el carrete. 0 g para bobinas vacías.')})}</div>
    <div data-spool-gross hidden>${field(uiText('Peso en báscula por bobina (g)'),'grossGrams',{type:'number',extra:'disabled inputmode="decimal" min="215" max="100000" step="0.001"',hint:uiText('Incluye el filamento y el carrete.')})}</div>
    <div data-spool-tare hidden>${field(uiText('Peso de la bobina vacía (g)'),'tareGrams',{type:'number',value:standardTareGrams,extra:'disabled inputmode="decimal" min="0" max="100000" step="0.001"',hint:uiText('215 g por defecto. Puedes ajustarlo si tu carrete pesa distinto.')})}</div>
    <p data-spool-weight-result aria-live="polite" hidden></p>
    <p class="full muted" data-spool-tare-note>${uiText('Bobina vacía: 215 g estándar. Se descuenta del peso de la báscula al registrar bobinas empezadas.')}</p>
    </div><section class="spool-batch-preview" aria-live="polite"><h3>${uiText('Tus etiquetas')}</h3><div data-spool-labels>${uiText('Selecciona material, marca y color para ver los códigos.')}</div><p class="muted">${uiText('La secuencia incluye bobinas vacías y eliminadas. Los códigos se confirman al guardar.')}</p></section>
    <details class="ipad-spool-options"><summary>${uiText('Más opciones')}</summary>${field(uiText('Avisar cuando queden menos de (g)'),'lowGrams',{type:'number',value:100,extra:'inputmode="decimal" min="0" max="100000" step="0.001"'})}</details>`;
  openForm(uiText('Agregar bobinas'),body,async v=>{
    if(!state.connected)throw new Error(uiText('Sin conexión con Hudson. Espera un momento antes de guardar.'));
    const result=await mutate('/api/spools/batch',spoolBatchPayload(v));
    toast(uiText('Bobinas registradas. Cada una tiene su propia etiqueta.'));return result;
  },{subtitle:uiText('Registra una o varias bobinas iguales de una sola vez.'),submit:uiText('Agregar bobinas'),dialogClass:ipad?'ipad-inventory-dialog':'',onSuccess:result=>{
    if(!result?.spools?.length)return;
    openForm(uiText('Bobinas registradas'),`<p>${uiText('Escribe un código en cada cinta y pégala en su bobina.')}</p>${spoolTags(result.spools,esc)}<p class="muted">${uiText('Conserva el código cuando se termine el filamento.')}</p>`,()=>{},{hideSubmit:true,dialogClass:ipad?'ipad-inventory-dialog':''});
  },after:form=>{
    const value=name=>form.elements.namedItem(name)?.value;
    const update=event=>{
      for(const [name,custom] of [['material','customMaterial'],['brand','customBrand'],['color','customColor']]){
        const visible=value(name)==='other';form.querySelector(`[data-spool-custom="${name}"]`).hidden=!visible;form.elements.namedItem(custom).disabled=!visible;
      }
      const weight=form.elements.namedItem('remainingGrams'),kind=value('fillState'),partial=kind==='partial';
      const gross=form.elements.namedItem('grossGrams'),tare=form.elements.namedItem('tareGrams');
      if(weight){
        if(event?.target?.name==='fillState')weight.value=kind==='empty'?'0':kind==='full'?'1000':'';
        weight.readOnly=kind==='empty';weight.disabled=partial;
      }
      if(gross&&tare){
        gross.disabled=tare.disabled=!partial;gross.min=tare.value;
        if(event?.target?.name==='fillState')gross.value='';
      }
      for(const [selector,hidden] of [['[data-spool-net]',partial],['[data-spool-gross]',!partial],['[data-spool-tare]',!partial],['[data-spool-weight-result]',!partial],['[data-spool-tare-note]',partial]])form.querySelector(selector).hidden=hidden;
      if(partial){
        const result=form.querySelector('[data-spool-weight-result]');
        try{
          const grossGrams=spoolWeight(value('grossGrams')),tareGrams=spoolWeight(value('tareGrams'));
          result.textContent=grossGrams<tareGrams?uiText('El peso de la báscula no puede ser menor que el de la bobina vacía.'):ht`Filamento por bobina: ${grams((Math.round(grossGrams*1000)-Math.round(tareGrams*1000))/1000)} g`;
        }catch{result.textContent=uiText('Escribe el peso de la báscula para calcular el filamento restante.');}
      }
      const preview=form.querySelector('[data-spool-labels]'),submit=form.querySelector('[type="submit"]');
      try {
        const input=spoolBatchPayload(Object.fromEntries(['material','customMaterial','brand','customBrand','color','customColor','quantity','fillState','remainingGrams','grossGrams','tareGrams','lowGrams'].map(name=>[name,value(name)])));
        const plan=planSpoolLabels(state.data?.inventory,input);
        const remainingGrams=input.remainingGrams??(Math.round(input.grossGrams*1000)-Math.round(input.tareGrams*1000))/1000;
        const total=input.quantity===1?ht`Total: ${grams(remainingGrams)} g en 1 bobina`:ht`Total: ${grams(remainingGrams*input.quantity)} g en ${input.quantity} bobinas`;
        preview.innerHTML=spoolTags(plan.labels.map(label=>({...label,...input,remainingGrams})),esc)+`<p class="spool-batch-total">${esc(total)}</p>`;
      }catch(error){preview.textContent=translateMessage(error.message);}
      if(submit)submit.textContent=Number(value('quantity'))===1?uiText('Agregar bobina'):ht`Agregar ${value('quantity')||''} bobinas`;
    };
    form.addEventListener('input',update);form.addEventListener('change',update);update();
    form.addEventListener('invalid',event=>{event.target.closest('details')?.setAttribute('open','');},true);
  }});
}

export function spoolDeleteBlock(data,id) {
  const spool=data?.inventory?.spools?.find(s=>s.id===id&&!s.archived);
  if(!spool)return uiText('Esta bobina ya no está en el inventario.');
  const queues=data.queues||[];
  if(queues.some(q=>q.active?.attempt?.allocations?.some(a=>a.spoolId===id)))
    return uiText('Esta bobina pertenece a una impresión pendiente de cerrar. Primero termina y confirma la recolección.');
  if(spool.mount)return uiText('Esta bobina está cargada en una impresora. Primero retírala y actualiza su asignación en Filamento.');
  if(spool.reservedGrams>0||queues.some(q=>q.pending?.some(j=>j.materialChange?.enabled&&j.materialChange.filaments?.some(f=>f.spoolId===id))))
    return uiText('Esta bobina está asignada a trabajos pendientes. Elige otra bobina para esos trabajos antes de eliminarla.');
  return '';
}

// Use the existing archival API: remove from inventory while retaining usage history.
export async function openDeleteSpoolForm({id,state,esc,openForm,mutate,toast,readSnapshot,ipad=false}) {
  if(!state.connected){toast(uiText('Conecta con Hudson para eliminar una bobina.'),true);return;}
  const data=await readSnapshot(),spool=data.inventory?.spools?.find(s=>s.id===id&&!s.archived);
  if(!spool){toast(uiText('Esta bobina ya no está en el inventario.'),true);return;}
  const block=spoolDeleteBlock(data,id);
  const summary=`<div class="summary-box"><strong>${esc(spool.name)}</strong><p>${esc(spool.material)} · ${grams(spool.remainingGrams)} g</p></div>`;
  openForm(uiText('Eliminar bobina'),summary+(block?`<div class="notice">${esc(block)}</div>`:`<p>${uiText('Se quitará esta bobina del inventario. Su historial y sus consumos se conservarán.')}</p>`),async()=>{
    // Re-read before confirmation, including changes made from another PC or iPad.
    const latest=await readSnapshot(),reason=spoolDeleteBlock(latest,id);
    if(reason)throw new Error(reason);
    await mutate(`/api/spools/${encodeURIComponent(id)}/edit`,{archived:true});
    toast(uiText('Bobina eliminada del inventario.'));
  },{hideSubmit:!!block,submit:uiText('Eliminar bobina'),submitClass:'danger',iconName:'trash',dialogClass:ipad?'ipad-inventory-dialog':''});
}

export async function openDeleteAllSpoolsForm({state,esc,openForm,mutate,toast,readSnapshot,ipad=false}) {
  if(!state.connected){toast(uiText('Conecta con Hudson para eliminar una bobina.'),true);return;}
  const data=await readSnapshot(),spools=(data.inventory?.spools||[]).filter(s=>!s.archived);
  const eligible=spools.filter(s=>!spoolDeleteBlock(data,s.id)),blocked=spools.filter(s=>spoolDeleteBlock(data,s.id));
  const list=rows=>`<ul class="spool-delete-list">${rows.map(s=>`<li><strong>${esc(s.name)}</strong>${blocked.includes(s)?`<p>${esc(spoolDeleteBlock(data,s.id))}</p>`:''}</li>`).join('')}</ul>`;
  const body=`<p>${uiText('Se revisa todo el inventario, aunque tengas una búsqueda o un filtro activo.')}</p>`+
    (eligible.length?`<div class="form-section"><h3>${ht`Se eliminarán: ${eligible.length}`}</h3>${list(eligible)}</div><p>${uiText('Se conservarán el historial y los consumos de las bobinas eliminadas.')}</p>`:`<div class="notice neutral">${uiText('No hay bobinas disponibles para eliminar.')}</div>`)+
    (blocked.length?`<div class="form-section"><h3>${ht`Se conservarán por estar en uso: ${blocked.length}`}</h3>${list(blocked)}</div>`:'')+
    (eligible.length?`<label class="check"><input name="confirmDelete" type="checkbox" required><span>${uiText('Confirmo que quiero eliminar las bobinas indicadas.')}</span></label>`:'');
  // Freeze the reviewed IDs. Spools added later are never included in this confirmation.
  const deleted=new Set();
  openForm(uiText('Eliminar todas'),body,async values=>{
    if(!eligible.length||values.confirmDelete!=='on')throw new Error(uiText('Confirma la eliminación de las bobinas indicadas.'));
    for(const spool of eligible){
      try{
        const latest=await readSnapshot(),current=latest.inventory?.spools?.find(s=>s.id===spool.id);
        if(!current||current.archived){deleted.add(spool.id);continue;}
        const reason=spoolDeleteBlock(latest,spool.id);
        if(reason)throw new Error(`${spool.name}: ${reason}`);
        await mutate(`/api/spools/${encodeURIComponent(spool.id)}/edit`,{archived:true});
        deleted.add(spool.id);
      }catch(error){
        // Stop on failure; leave the dialog open and report confirmed progress honestly.
        throw new Error(ht`Eliminaciones confirmadas: ${deleted.size}. ${translateMessage(error.message)}`);
      }
    }
    toast(ht`Bobinas eliminadas del inventario: ${deleted.size}.`);
  },{hideSubmit:!eligible.length,submit:uiText('Confirmar eliminación'),submitClass:'danger',iconName:'trash',dialogClass:ipad?'ipad-inventory-dialog':''});
}

export function createIpadInventory({state,esc,openForm,mutate,toast,refresh,readSnapshot}) {
  function location(spool) {
    if(!spool.mount)return uiText('En inventario · Sin asignar');
    const m=spool.mount,p=state.data.printers.find(p=>p.id===m.printerId);
    return `${p?.name||p?.model||uiText('Impresora')} · ${m.source==='external'?uiText('Rollo externo'):ht`AMS ${m.amsId+1} · Posición ${m.slotId+1}`}`;
  }
  function loaded(printer,queue) {
    const positions=filamentPositions(printer,state.data?.inventory?.spools);
    if(!positions.length)return uiText('<p class="operator-filament-empty">Filamento sin confirmar</p>');
    const fresh=state.connected&&printer.telemetry?.fresh;
    const multipleAms=new Set(positions.filter(s=>s.source==='ams').map(s=>s.amsId)).size>1;
    return ht`<div class="operator-filaments" aria-label="Filamento cargado en ${esc(printer.name||printer.model)}"><span class="operator-filament-group-name">Filamento cargado</span><div class="operator-filament-dots">${positions.map(s=>{
      const inJob=!!s.spool&&queue?.active?.attempt?.allocations?.some(a=>a.spoolId===s.spool.id);
      const inUse=fresh&&filamentRunning(printer.telemetry)&&[...(printer.telemetry.filamentUse?.current||[]),...(printer.telemetry.filamentUse?.target||[])].includes(s.key);
      const note=!fresh?uiText('Último registro'):inUse?uiText('En uso'):s.spool?(!s.report||s.report.empty?uiText('Revisar posición'):inJob?uiText('En esta placa'):''):s.report&&!s.report.empty?uiText('Sin registrar'):uiText('Vacío');
      const label=`${s.label} · ${s.spool?.name||note}${inJob?uiText(' · Asignada a esta placa'):''}`;
      return `<button type="button" class="operator-filament-dot ${inJob?'in-job':''}" data-action="operator-filament" data-id="${esc(printer.id)}" data-source="${esc(s.key)}" aria-label="${esc(label)}"><span class="filament-circle ${s.color?'':'is-unknown'}" style="--filament-color:${s.color||'transparent'}" aria-hidden="true"><small>${s.source==='external'?(s.amsId===255?'E2':'E'):multipleAms?`${s.amsId+1}:${s.slotId+1}`:s.slotId+1}</small></span><span class="operator-filament-name">${esc(s.spool?.name||note)}</span>${s.spool&&note?`<small class="operator-filament-note">${esc(note)}</small>`:''}</button>`;
    }).join('')}</div></div>`;
  }
  function change(printerId,key) {
    const p=state.data?.printers.find(p=>p.id===printerId),spools=state.data?.inventory?.spools||[];
    const position=filamentPositions(p,spools).find(s=>s.key===key);if(!position)return;
    const q=state.data?.queues?.find(q=>q.printerId===printerId),reason=filamentChangeReason(p,q,state.connected,position);
    const original=position.spool?.id||null;
    const unavailable=s=>s.mount&&(s.mount.printerId!==printerId||sourceKey(s.mount)!==key)?ht`Cargada en ${location(s)}`:p.enforceFilamentChecks!==false&&s.stockUncertain?uiText('Saldo por revisar'):p.enforceFilamentChecks!==false&&s.remainingGrams<=0?uiText('Sin saldo'):assignmentSpoolBlock(state.data,s,state.connected);
    const rolls=spools.filter(s=>!s.archived).sort((a,b)=>(a.id===original?-1:b.id===original?1:0)||a.name.localeCompare(b.name,locale(),{numeric:true}));
    const summary=position.spool?ht`<strong>${esc(position.spool.name)}</strong><p>${esc(position.spool.material)} · ${esc(position.spool.brand||uiText('Marca sin registrar'))} · ${grams(position.spool.remainingGrams)} g restantes</p><small>${position.spool.balanceIsEstimate?uiText('Saldo estimado'):uiText('Peso medido')}</small>`:position.report&&!position.report.empty?ht`<strong>Bobina sin registrar</strong><p>En la impresora: ${esc(position.report.material)}. Selecciona la bobina física de tu inventario.</p>`:uiText('<strong>Sin bobina registrada</strong>');
    const choice=s=>{
      const blocked=unavailable(s),color=filamentColor(s.color);
      const note=blocked||s.id===original&&uiText('Actual');
      return `<label class="spool-choice ${blocked?'is-unavailable':''}"><input type="radio" name="spoolId" value="${esc(s.id)}" required ${s.id===original?'checked':''} ${blocked?'disabled':''}><span class="spool-choice-face"><span class="filament-circle ${color?'':'is-unknown'}" style="--filament-color:${color||'transparent'}" aria-hidden="true"></span><span class="spool-choice-copy"><strong>${esc(s.name)}</strong><small>${esc(s.brand||uiText('Sin marca'))}</small></span><span class="spool-choice-weight">${grams(s.remainingGrams)} g</span>${note?`<small class="material-spool-note">${esc(note)}</small>`:''}<span class="filament-selected-mark" aria-hidden="true">✓</span></span></label>`;
    };
    const picker=`<fieldset class="material-picker"><legend>${uiText('Selecciona la bobina que vas a colocar.')}</legend><div class="material-spool-grid">${spoolMaterialGroups(rolls).map((group,i)=>`<section class="material-spool-group" aria-labelledby="spool-material-${i}"><h3 id="spool-material-${i}">${esc(group.material||uiText('Sin material'))}<span aria-hidden="true">${group.spools.length}</span></h3><div class="material-spool-list">${group.spools.map(choice).join('')}</div></section>`).join('')}</div>${!rolls.length?uiText('<p class="filament-picker-empty">Agrega primero tus bobinas en la pestaña Inventario.</p>'):''}<label class="spool-choice material-empty-choice"><input type="radio" name="spoolId" value="empty" required><span class="spool-choice-face"><span class="filament-circle is-unknown" aria-hidden="true"></span><span class="spool-choice-copy"><strong>${uiText('Dejar posición vacía')}</strong><small>${uiText('Retiré la bobina')}</small></span><span class="filament-selected-mark" aria-hidden="true">✓</span></span></label></fieldset><label class="operator-check material-picker-confirm"><input type="checkbox" name="confirmed" required><span data-spool-confirm>${uiText('Confirmo que esta es la bobina colocada en la posición indicada.')}</span></label>`;
    const warning=q?.active?.attempt?.allocations?.some(a=>a.sourceKey===key)?`<p class="notice">${uiText('Esta placa puede volver a usar esta posición. Coloca el material y color que necesita.')}</p>`:'';
    openForm(reason?uiText('Filamento cargado'):uiText('Cambiar filamento'),reason?`<div class="summary-box">${summary}</div><div class="notice neutral">${esc(reason)}</div>`:warning+picker,async v=>{
      await refresh?.({render:false});
      const currentPrinter=state.data?.printers.find(p=>p.id===printerId),currentQueue=state.data?.queues?.find(q=>q.printerId===printerId);
      const block=filamentChangeReason(currentPrinter,currentQueue,state.connected,position);if(block)throw new Error(block);
      const current=filamentPositions(currentPrinter,state.data?.inventory?.spools).find(s=>s.key===key);
      if(!current||(current.spool?.id||null)!==original)throw new Error(uiText('Esta posición cambió. Cierra y vuelve a revisar la bobina.'));
      if(!v.confirmed)throw new Error(uiText('Confirma primero el cambio físico de la bobina.'));
      if(!v.spoolId)throw new Error(uiText('Selecciona una bobina del inventario.'));
      const id=v.spoolId==='empty'?null:v.spoolId;
      if(id===original)throw new Error(uiText('Esta bobina ya está registrada aquí. Elige otra o cierra esta ventana.'));
      if(id){const s=state.data.inventory.spools.find(s=>s.id===id&&!s.archived);if(!s)throw new Error(uiText('La bobina ya no está disponible.'));const why=unavailable(s);if(why)throw new Error(why);}
      await mutate(`/api/printers/${printerId}/materials`,{spoolId:id,source:position.source,amsId:position.amsId,slotId:position.slotId,confirmed:true});
      toast(id?uiText('Bobina cargada registrada.'):uiText('Posición registrada sin bobina.'));
    },{submit:uiText('Confirmar cambio'),subtitle:`${p.name||p.model} · ${position.label}`,hideSubmit:!!reason,dialogClass:'ipad-inventory-dialog',after:form=>{
      if(reason)return;
      form.closest?.('dialog')?.classList.add('material-picker-dialog');
      const confirmation=form.querySelector('.material-picker-confirm');
      if(confirmation)form.querySelector('.dialog-footer')?.prepend?.(confirmation);
      form.addEventListener('change',event=>{
        if(event.target.name!=='spoolId')return;
        form.elements.confirmed.checked=false;
        const id=event.target.value,s=spools.find(s=>s.id===id);
        form.querySelector('[data-spool-confirm]').textContent=id==='empty'?ht`Ya retiré la bobina de ${position.label}.`:ht`Ya coloqué ${s?.name||uiText('esta bobina')} en ${position.label}.`;
      });
    }});
  }
  function render() {
    const spools=(state.data?.inventory?.spools||[]).filter(s=>!s.archived).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    return `<section class="ipad-inventory" aria-labelledby="ipad-inventory-title">
      <div class="ipad-inventory-heading"><div><h2 id="ipad-inventory-title">${uiText('Inventario')}</h2><p>${uiText('Registra tus rollos y consulta cuánto filamento queda.')}</p></div><div class="spool-inventory-actions"><button type="button" class="ipad-add-spool" data-action="operator-add-spool" ${state.connected?'':'disabled'}><span aria-hidden="true">＋</span> ${uiText('Agregar filamento')}</button><button type="button" class="btn danger" data-action="operator-delete-all-spools" ${state.connected&&spools.length?'':'disabled'}>${uiText('Eliminar todas')}</button></div></div>
      ${spools.length?ht`<p class="ipad-inventory-count">${spools.length} ${spools.length===1?uiText('rollo registrado'):uiText('rollos registrados')} · Compartido con Hudson en tu PC</p><div class="ipad-spool-grid">${spools.map(s=>{
        const color=/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s.color||'')?s.color:'#ddd4c8';
        return ht`<article class="ipad-spool-card"><div class="ipad-spool-heading"><span class="ipad-spool-swatch" style="--filament-color:${color}" aria-hidden="true"></span><div><h3>${esc(s.name)}</h3><p>${esc(s.material)} · ${esc(s.brand||uiText('Sin marca registrada'))}</p></div></div><p class="ipad-spool-weight">${grams(s.remainingGrams)} <span>g ${s.stockUncertain?uiText('registrados'):uiText('restantes')}</span></p><p class="ipad-spool-basis">${s.stockUncertain?uiText('Consumo pendiente de registrar'):s.balanceIsEstimate?uiText('Saldo estimado'):uiText('Peso medido')}</p><dl class="ipad-spool-balances"><div><dt>Reservados en cola</dt><dd>${grams(s.reservedGrams)} g</dd></div><div><dt>Disponibles para nuevos trabajos</dt><dd>${s.stockUncertain?uiText('Por confirmar'):grams(s.availableGrams??s.remainingGrams-s.reservedGrams)+' g'}</dd></div></dl><p class="ipad-spool-location">${esc(location(s))}</p>${(s.stockUncertain?ht`<p class="ipad-spool-alert">${esc(s.uncertaintyReason||uiText('Revisa los gramos que quedan.'))}</p><button type="button" class="btn" data-action="operator-weigh-spool" data-id="${esc(s.id)}" ${state.connected?'':'disabled'}>Actualizar saldo</button>`:s.alerts?.length?uiText('<p class="ipad-spool-alert">Por revisar en Filamento de Hudson.</p>'):'')+`<button type="button" class="btn danger spool-delete-button" data-action="operator-delete-spool" data-id="${esc(s.id)}" ${state.connected?'':'disabled'}>${uiText('Eliminar bobina')}</button>`}</article>`;
      }).join('')}</div>`:uiText('<div class="ipad-inventory-empty"><span class="ipad-empty-spool" aria-hidden="true"></span><h3>Agrega tu primer rollo</h3><p>Selecciona material, marca y color, y escribe los gramos de filamento.</p></div>')}
    </section>`;
  }
  function add() {openSpoolForm({state,esc,openForm,mutate,toast,ipad:true});}
  function weigh(id) {const spool=state.data?.inventory?.spools?.find(s=>s.id===id&&!s.archived);if(spool)openSpoolForm({state,esc,openForm,mutate,toast,spool,ipad:true});}
  function remove(id){return openDeleteSpoolForm({id,state,esc,openForm,mutate,toast,readSnapshot,ipad:true});}
  function removeAll(){return openDeleteAllSpoolsForm({state,esc,openForm,mutate,toast,readSnapshot,ipad:true});}
  return {render,add,loaded,change,weigh,remove,removeAll};
}
