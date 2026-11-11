import {t as uiText,ht,locale,translateMessage,languageSelector} from './i18n.js';
import { filamentPositions,filamentColor,filamentLocation } from './ipad-inventory.js';

const type=v=>String(v||'').trim().toUpperCase();
const color=v=>String(v||'').replace(/^#/,'').slice(0,6).toUpperCase();
const grams=v=>new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(Number(v)||0);
const key=m=>`${m.source}:${m.amsId}:${m.slotId}`;
export const plannedChanges=job=>job?.materialPlan?.enforceFilamentChecks===false?[]:(job?.materialPlan?.issues||[]).filter(i=>i.code==='FILAMENT_CHANGE_REQUIRED');
export function plannedSpoolChoices(printer,spools,filament,source) {
  return spools.filter(s=>!s.archived).map(s=>{
    const enforce=printer.enforceFilamentChecks!==false;
    const reason=enforce&&type(s.material)!==type(filament.type)?uiText('Material distinto al archivo'):enforce&&s.stockUncertain?uiText('Saldo por revisar'):enforce&&s.remainingGrams<=0?uiText('Sin filamento'):
      s.mount&&(s.mount.printerId!==printer.id||key(s.mount)!==source)?uiText('Colocada en otra ubicación'):'';
    return {...s,usable:!reason,reason,matchesFile:!filament.color||color(s.color)===color(filament.color)};
  }).sort((a,b)=>Number(b.matchesFile)-Number(a.matchesFile)||a.name.localeCompare(b.name,locale(),{numeric:true}));
}
export function plannedFilamentPicker({printer,spools,filament,selectedSource='',selectedSpool='',esc}) {
  const positions=filamentPositions(printer,spools);
  const source=positions.some(s=>s.key===selectedSource)?selectedSource:positions.length===1?positions[0].key:'';
  const rolls=plannedSpoolChoices(printer,spools,filament,source),selected=rolls.find(s=>s.id===selectedSpool&&s.usable)?.id||(!selectedSpool?rolls.find(s=>s.usable&&s.matchesFile)?.id:'');
  const dot=c=>`<span class="filament-circle ${filamentColor(c)?'':'is-unknown'}" style="--filament-color:${filamentColor(c)||'transparent'}" aria-hidden="true"></span>`;
  return ht`<fieldset class="filament-picker planned-filament"><legend>Filamento ${esc(filament.id)} · ${esc(filament.type)} · ${grams(filament.grams)} g</legend><p class="filament-picker-hint">1. Elige dónde irá la bobina</p><div class="filament-picker-options">${positions.map(s=>ht`<label class="filament-option"><input type="radio" data-planned-source="${esc(filament.id)}" name="map-${esc(filament.id)}" value="${esc(s.key)}" required ${s.key===source?'checked':''}><span class="filament-option-face">${dot(s.spool?.color||s.report?.color)}<strong>${esc(s.label)}</strong><small>Ahora: ${esc(s.spool?.name||uiText('Sin bobina registrada'))}</small><span class="filament-selected-mark" aria-hidden="true">✓</span></span></label>`).join('')}</div>${positions.length?'':uiText('<p class="filament-picker-empty">Conecta la impresora para conocer sus posiciones de filamento.</p>')}<p class="filament-picker-hint">2. Elige la bobina para este trabajo</p><div class="filament-picker-options">${rolls.map(s=>ht`<label class="filament-option ${s.usable&&source?'':'is-unavailable'}"><input type="radio" name="planned-spool-${esc(filament.id)}" value="${esc(s.id)}" required ${s.usable&&source?'':'disabled'} ${s.id===selected&&source?'checked':''}><span class="filament-option-face">${dot(s.color)}<strong>${esc(s.name)}</strong><span>${esc(s.material)} · ${esc(s.brand||uiText('Sin marca'))}</span><small>${grams(s.remainingGrams)} g restantes</small><small>${grams(s.availableGrams??s.remainingGrams)} g disponibles</small>${s.reason?`<em>${esc(s.reason)}</em>`:s.matchesFile?uiText('<small>Color del archivo</small>'):uiText('<em>Usar este color para el trabajo</em>')}<span class="filament-selected-mark" aria-hidden="true">✓</span></span></label>`).join('')}</div>${rolls.some(s=>s.usable)?'':uiText('<p class="filament-picker-empty">No hay bobinas compatibles disponibles. Agrégalas en Inventario.</p>')}</fieldset>`;
}
export function plannedChangeSummary(job,esc) {
  if(!job?.materialChange?.enabled)return '';
  const pending=plannedChanges(job),names=[...new Set((pending.length?pending.map(p=>p.target?.name):job.materialChange.filaments.map(f=>f.name)).filter(Boolean))];
  return `<p class="planned-change-label">${pending.length?uiText('Cambio pendiente'):uiText('Filamento programado')}: ${esc(names.join(', '))}</p>`;
}
export function plannedChangeSteps(job,esc) {
  return ht`<div class="planned-change-instructions">${plannedChanges(job).map(i=>ht`<div class="planned-change-target"><span class="filament-circle ${filamentColor(i.target?.color)?'':'is-unknown'}" style="--filament-color:${filamentColor(i.target?.color)||'transparent'}" aria-hidden="true"></span><div><strong>${esc(i.target?.name||uiText('Bobina programada'))}</strong><p>${esc(i.target?.material)} · ${esc(filamentLocation(i.source))}</p><small>Reemplaza ${esc(i.loaded?.name||uiText('la bobina actual'))} por esta bobina.</small></div></div>`).join('')}<p>Completa la descarga y la carga siguiendo las indicaciones de la impresora. Confirma cuando las bobinas indicadas estén colocadas y el filamento esté listo.</p></div>`;
}
