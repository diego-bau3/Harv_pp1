// Stable physical labels: never translate these names with the interface.
export const spoolColors=[['#000000','Negro'],['#FFFFFF','Blanco'],['#808080','Gris'],['#E8A0BB','Rosa'],['#87CEEB','Azul claro'],['#C0C0C0','Gris plata'],['#306BC8','Azul'],['#172554','Azul marino'],['#E53935','Rojo'],['#43865C','Verde'],['#A8D5A2','Verde claro'],['#F3CF46','Amarillo'],['#EF893D','Naranja'],['#8D62B4','Morado'],['#C8A2C8','Lila'],['#854C30','Café'],['#C8B59B','Beige'],['#D4AF37','Dorado'],['#B87333','Cobre']];
export const labelKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const brandKey=value=>{const key=labelKey(value);return key==='BAMBULAB'?'BAMBULABS':key;};
const defaults={MEXICOMAKERS:'M',ELEGOO:'E',BAMBULABS:'B',CHINA:'C'};
function colorLabel(color) {
  const hex=String(color||'').slice(0,7).toUpperCase();
  const name=spoolColors.find(([value])=>value===hex)?.[1]||`Color${hex.replace('#','')}`;
  return name.split(' ').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
}
export function labelRegistry(saved={},spools=[]) {
  const registry={brands:{...defaults,...saved.brands},counters:{...saved.counters},used:{...saved.used}};
  for(const spool of spools) {
    if(spool.name)registry.used[labelKey(spool.name)]=true;
    if(spool.labelCode)registry.used[labelKey(spool.labelCode)]=true;
    if(spool.labelSeries&&Number.isSafeInteger(spool.labelNumber))registry.counters[spool.labelSeries]=Math.max(registry.counters[spool.labelSeries]||0,spool.labelNumber);
  }
  // Stable order also makes simultaneous PC/iPad previews agree on custom brands.
  for(const brand of [...new Set(spools.map(s=>s.brand).filter(Boolean))].sort())brandCode(registry,brand);
  // Older physical labels omitted the brand letter (e.g. Blanco02). Their
  // recorded brand/color identifies the series; keep their existing names.
  for(const spool of spools) {
    if(!spool.brand||!spool.color)continue;
    const color=labelKey(colorLabel(spool.color)),code=brandCode(registry,spool.brand),series=color+code;
    const name=labelKey(spool.name),tail=name.startsWith(series)?name.slice(series.length):name.startsWith(color)?name.slice(color.length):'';
    if(/^\d+$/.test(tail)&&Number.isSafeInteger(Number(tail)))registry.counters[series]=Math.max(registry.counters[series]||0,Number(tail));
  }
  return registry;
}
function brandCode(registry,brand) {
  const key=brandKey(brand);
  if(Object.hasOwn(registry.brands,key))return registry.brands[key];
  const words=String(brand).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/[A-Z]+/g)||[];
  const base=(words.length>1?words.map(word=>word[0]).join(''):words[0]?.slice(0,3))||'OT';
  let code=base.slice(0,8),suffix=0;
  while(Object.values(registry.brands).includes(code)) {
    let n=++suffix,tail='';while(n){n--;tail=String.fromCharCode(65+n%26)+tail;n=Math.floor(n/26);}
    code=base.slice(0,8)+tail;
  }
  registry.brands[key]=code;return code;
}
export function planSpoolLabels(inventory,input) {
  const registry=labelRegistry(inventory?.labelRegistry,inventory?.spools||[]);
  const color=String(input.color||'').slice(0,7).toUpperCase();
  const colorCode=colorLabel(color);
  const code=brandCode(registry,input.brand),prefix=colorCode+code,series=labelKey(prefix);
  let number=registry.counters[series]||0;
  // Includes empty, archived, manually named and previously renamed spools.
  for(const used of Object.keys(registry.used)) {
    if(!used.startsWith(series))continue;
    const tail=used.slice(series.length);
    if(/^\d+$/.test(tail)&&Number.isSafeInteger(Number(tail)))number=Math.max(number,Number(tail));
  }
  const quantity=Number(input.quantity??1);
  if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new Error('Indica entre 1 y 100 bobinas.');
  if(!Number.isSafeInteger(number+quantity))throw new Error('La numeración de esta serie necesita revisión.');
  const labels=Array.from({length:quantity},()=>{
    number++;
    const label={name:prefix+String(number).padStart(2,'0'),labelSeries:series,labelNumber:number};
    registry.used[labelKey(label.name)]=true;return label;
  });
  registry.counters[series]=number;
  return {labels,registry,brandCode:code};
}
