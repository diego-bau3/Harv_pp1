import {language,locale} from './i18n.js';

const t=(es,en)=>language()==='en'?en:es;
const zone='America/Mexico_City';
const calendar=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return {day:`${p.year}-${p.month}-${p.day}`,month:`${p.year}-${p.month}`,year:p.year};};
export function createStatistics({api,esc,header,repaint,getDemo}){
  const selected={period:'month',...calendar(),printer:'all'};
  let data=null,error='',busy=false,version=0,lastAttempt=0;
  const number=(n,digits=0)=>new Intl.NumberFormat(locale(),{maximumFractionDigits:digits}).format(n||0);
  const hours=seconds=>`${number(seconds/3600,1)} h`;
  const kg=grams=>`${number(grams/1000,3)} kg`;
  const options=(items,value)=>items.map(([v,label])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(label)}</option>`).join('');
  async function load(){
    const current=++version;busy=true;error='';lastAttempt=Date.now();
    try{const result=await api(`/api/statistics?${new URLSearchParams(selected)}`);if(current===version)data=result;}
    catch(e){if(current===version){data=null;error=t('No se pudieron cargar las estadísticas. Inténtalo de nuevo.','Statistics could not be loaded. Please try again.');}}
    finally{if(current===version){busy=false;repaint();}}
  }
  function change(field,value){
    if(!['period','day','month','year','printer'].includes(field))return;
    if(field==='period'&&!['day','month','year','all'].includes(value))return;
    if(field==='day'&&(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value))return;
    if(field==='month'&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))return;
    if(field==='year'&&!/^20\d{2}$/.test(value))return;
    selected[field]=value;if(field==='day'){selected.month=value.slice(0,7);selected.year=value.slice(0,4);}if(field==='month')selected.year=value.slice(0,4);
    data=null;void load();repaint();
  }
  function bucketLabel(key){
    if(key.includes('T'))return new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:zone}).format(new Date(key));
    if(key.length===4)return key;
    if(key.length===10)return String(Number(key.slice(-2)));
    return new Intl.DateTimeFormat(locale(),{month:'short',timeZone:'UTC'}).format(new Date(`${key}-01T12:00:00Z`));
  }
  function render(){
    if(getDemo?.())return header(t('Estadísticas','Statistics'),t('Tu producción por día, por mes, por año y desde el inicio.','Your production by day, by month, by year and since the beginning.'))+`<section class="panel statistics-message">${t('Las estadísticas estarán disponibles al volver a tu taller y consultar su historial real.','Statistics are available in your workshop using its actual history.')}</section>`;
    if(!busy&&Date.now()-lastAttempt>30000)void load();
    const years=[...new Set([Number(selected.year),...(data?.availableYears||[Number(calendar().year)])])].sort((a,b)=>b-a);
    const printers=data?.printers||lastPrinters;
    if(data)lastPrinters=data.printers;
    const filters=`<div class="statistics-filters"><div class="segmented" role="group" aria-label="${t('Periodo','Period')}">${[['day',t('Día','Day')],['month',t('Mes','Month')],['year',t('Año','Year')],['all',t('Todo el historial','All time')]].map(([value,label])=>`<button type="button" data-stat-period="${value}" class="${selected.period===value?'selected':''}" aria-pressed="${selected.period===value}">${label}</button>`).join('')}</div>${selected.period==='day'?`<label class="field"><span>${t('Fecha','Date')}</span><input aria-label="${t('Fecha','Date')}" type="date" min="2000-01-01" max="2099-12-31" value="${selected.day}" data-stat-filter="day"></label>`:selected.period==='month'?`<label class="field"><span>${t('Mes','Month')}</span><input aria-label="${t('Mes','Month')}" type="month" min="2000-01" max="2099-12" value="${selected.month}" data-stat-filter="month"></label>`:selected.period==='year'?`<label class="field"><span>${t('Año','Year')}</span><select data-stat-filter="year">${options(years.map(y=>[y,y]),selected.year)}</select></label>`:''}<label class="field"><span>${t('Impresora','Printer')}</span><select data-stat-filter="printer">${options([['all',t('Todas las impresoras','All printers')],...printers.map(p=>[p.id,p.name||p.model||t('Impresora anterior','Former printer')])],selected.printer)}</select></label></div>`;
    const title=header(t('Estadísticas','Statistics'),t('Tu producción por día, por mes, por año y desde el inicio.','Your production by day, by month, by year and since the beginning.'));
    if(!data)return title+filters+`<section class="panel statistics-message" role="${error?'alert':'status'}">${error?`${error}<button class="btn" type="button" data-stat-retry>${t('Reintentar','Retry')}</button>`:t('Cargando estadísticas…','Loading statistics…')}</section>`;
    const s=data.totals;
    const cards=[
      [t('Piezas producidas','Good parts'),number(s.good),t('Buenas, confirmadas al retirar','Good parts confirmed at collection'),'good'],
      [t('Piezas fallidas','Failed parts'),number(s.rejected),t('Rechazadas al revisar la placa','Rejected during plate inspection'),'failed'],
      [t('Kg consumidos','Material consumed'),s.usageRecords||!s.missingMaterial?kg(s.grams):'—',`${t('Estimados','Estimated')}: ${kg(s.estimatedGrams)} · ${t('Medidos','Measured')}: ${kg(s.measuredGrams)}`,'material'],
      [t('Horas de impresión','Print hours'),s.timedAttempts?hours(s.seconds):s.missingTime?'—':'0 h',t('Tiempo registrado entre inicio y final','Recorded time between start and finish'),'time']
    ];
    const cardsHtml=`<div class="stats statistics-cards">${cards.map(([label,value,hint,kind])=>`<article class="stat statistics-card ${kind}"><div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><p>${hint}</p></div></article>`).join('')}</div>`;
    const max=Math.max(1,...data.buckets.map(b=>b.good+b.rejected));
    const chart=`<section class="panel statistics-chart"><div class="panel-header"><div><h2>${selected.period==='day'?t('Piezas por hora','Parts by hour'):t('Piezas por periodo','Parts by period')}</h2><p>${t('Buenas y fallidas, según los resultados registrados.','Good and failed parts, based on recorded results.')}</p></div><div class="statistics-legend"><span><i class="good"></i>${t('Buenas','Good')}</span><span><i class="failed"></i>${t('Fallidas','Failed')}</span></div></div><div class="statistics-bars" role="list" aria-label="${selected.period==='day'?t('Producción por hora','Production by hour'):t('Producción por periodo','Production by period')}">${data.buckets.map(b=>{const label=`${selected.period==='day'?bucketLabel(b.key):b.key}: ${number(b.good)} ${t('buenas','good')}, ${number(b.rejected)} ${t('fallidas','failed')}`;return `<div class="statistics-bar-column" role="listitem" aria-label="${esc(label)}" title="${esc(label)}"><span class="statistics-bar-value">${b.good+b.rejected?number(b.good+b.rejected):''}</span><div class="statistics-bar-track"><span class="failed" style="height:${b.rejected/max*100}%"></span><span class="good" style="height:${b.good/max*100}%"></span></div><span class="statistics-bar-label">${bucketLabel(b.key)}</span></div>`;}).join('')}</div>${!s.collections?`<p class="statistics-empty">${t('No hay piezas confirmadas en este periodo.','No confirmed parts in this period.')}</p>`:''}</section>`;
    const table=`<section class="panel statistics-table"><div class="panel-header"><h2>${t('Por impresora','By printer')}</h2></div><div class="history-scroll"><table class="quiet-table history-table"><thead><tr>${[t('Impresora','Printer'),t('Buenas','Good'),t('Fallidas','Failed'),t('Consumo registrado','Recorded consumption'),t('Horas registradas','Recorded hours')].map(v=>`<th scope="col">${v}</th>`).join('')}</tr></thead><tbody>${data.byPrinter.map(p=>`<tr><th scope="row">${esc(p.name||p.model||t('Impresora anterior','Former printer'))}</th><td>${number(p.good)}</td><td>${number(p.rejected)}</td><td>${p.usageRecords?kg(p.grams):p.missingMaterial?'—':'0 kg'}${p.missingMaterial||p.partialMaterial?`<small>${number(p.missingMaterial+p.partialMaterial)} ${t('sin consumo completo','without complete consumption')}</small>`:''}</td><td>${p.timedAttempts?hours(p.seconds):p.missingTime?'—':'0 h'}${p.missingTime?`<small>${number(p.missingTime)} ${t('sin tiempo completo','without complete time')}</small>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
    const notices=[];
    if(s.missingMaterial||s.partialMaterial)notices.push(`${number(s.missingMaterial+s.partialMaterial)} ${t('intentos sin consumo completo. Los kg mostrados son el subtotal disponible.','attempts without complete consumption. Kilograms show the available subtotal.')}`);
    if(s.missingTime)notices.push(`${number(s.missingTime)} ${s.missingTime===1?t('intento sin tiempo completo; no se incluye en las horas.','attempt without complete time; excluded from hours.'):t('intentos sin tiempo completo; no se incluyen en las horas.','attempts without complete time; excluded from hours.')}`);
    if(s.awaitingCollection)notices.push(`${number(s.awaitingCollection)} ${s.awaitingCollection===1?t('placa pendiente de retirar y clasificar. Sus piezas aún no se cuentan.','plate awaiting collection and inspection. Its parts are not counted yet.'):t('placas pendientes de retirar y clasificar. Sus piezas aún no se cuentan.','plates awaiting collection and inspection. Their parts are not counted yet.')}`);
    if(data.undated)notices.push(`${number(data.undated)} ${t('registros sin fecha, fuera de los totales.','undated records, excluded from totals.')}`);
    const notes=`<section class="statistics-notes">${notices.length?`<div class="notice">${notices.map(n=>`<p>${n}</p>`).join('')}</div>`:''}<details><summary>${t('Cómo se calculan estos números','How these numbers are calculated')}</summary><p>${t('Las piezas se atribuyen al final de la impresión; si falta esa fecha, se usa la recolección. Los trabajos cancelados o que no produjeron piezas no suman piezas fallidas.','Parts are assigned to print completion; when unavailable, collection time is used. Canceled jobs and jobs that produced no parts do not add failed parts.')}</p><p>${t('El consumo incluye lo registrado en intentos fallidos y usa la última corrección, sin duplicar descuentos. Los valores del slicer o del progreso son estimaciones.','Consumption includes recorded failed attempts and uses the latest correction without duplicating deductions. Slicer and progress values are estimates.')}</p><p>${t('Las horas usan el inicio y el final observados, pueden incluir pausas y se reparten entre los periodos que abarcan. No incluyen la espera para recoger la placa.','Hours use observed start and finish, may include pauses and are split across the periods they span. Waiting for plate collection is excluded.')}</p><p>${t('Solo se incluye lo registrado en Hudson. Las impresiones externas sin registrar no aparecen. Zona horaria: Ciudad de México.','Only Hudson records are included. Unrecorded external prints are excluded. Time zone: Mexico City.')}</p></details><p class="muted statistics-updated">${t('Actualizado','Updated')}: ${esc(new Date(data.generatedAt).toLocaleString(locale(),{timeZone:zone}))}</p></section>`;
    return title+filters+cardsHtml+chart+table+notes;
  }
  let lastPrinters=[];
  return {render,change,reload:load};
}
