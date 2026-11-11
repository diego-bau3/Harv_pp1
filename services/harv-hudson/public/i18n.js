import {english,spanish} from './translations.js';

const storageKey='hudson.language';
const supported=value=>value==='en'||value==='es';
function initialLanguage(){
  try{
    const requested=new URL(globalThis.location.href).searchParams.get('lang');
    if(supported(requested)){try{globalThis.localStorage.setItem(storageKey,requested);}catch{}return requested;}
    const saved=globalThis.localStorage.getItem(storageKey);
    return supported(saved)?saved:'es';
  }catch{return 'es';}
}
let selected=initialLanguage();
export const language=()=>selected;
export const locale=()=>selected==='en'?'en-US':'es-MX';
export function t(source){return (selected==='en'?english:spanish)[source]??source;}
// Only literal template parts are translated. Expressions are opaque values;
// names, identifiers, HTML escaping and data attributes retain their original meaning.
export function ht(parts,...values){
  const key=parts.map((part,i)=>part+(i<values.length?`{${i}}`:'')).join('');
  return t(key).replace(/\{(\d+)\}/g,(match,index)=>Number(index)<values.length?String(values[Number(index)]):match);
}
const patterns=Object.keys(english).filter(key=>/\{\d+\}/.test(key)&&!key.includes('<')).map(key=>{
  const ids=[],chunks=key.split(/(\{\d+\})/g);
  const expression=chunks.map(chunk=>{
    if(/^\{\d+\}$/.test(chunk)){ids.push(chunk.slice(1,-1));return '([\\s\\S]+?)';}
    return chunk.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }).join('');
  return {key,ids,re:new RegExp('^'+expression+'$')};
});
// Call at trusted diagnostic boundaries, never on user-entered names or notes.
export function translateMessage(value){
  const source=String(value??'');
  if(/^(Failed to fetch|Load failed|NetworkError|The operation was aborted)/i.test(source))return t('No se pudo conectar con Hudson. Revisa la conexión e inténtalo de nuevo.');
  if(selected!=='en')return source;
  if(english[source]!==undefined)return english[source];
  for(const {key,ids,re}of patterns){const match=source.match(re);if(match){const values={};ids.forEach((id,index)=>{values[id]=match[index+1];});return english[key].replace(/\{(\d+)\}/g,(token,id)=>values[id]??token);}}
  return source;
}
export function languageSelector(){
  return `<div class="language-selector" role="group" aria-label="${t('Idioma')}"><button type="button" data-language="en" lang="en" aria-label="English" aria-pressed="${selected==='en'}">EN</button><button type="button" data-language="es" lang="es" aria-label="Español" aria-pressed="${selected==='es'}">ES</button></div>`;
}
export function setLanguage(value,{reload=true}={}){
  if(!supported(value))return false;
  selected=value;
  try{globalThis.localStorage?.setItem(storageKey,value);}catch{}
  if(globalThis.document)document.documentElement.lang=value;
  if(reload&&globalThis.location){
    const url=new URL(location.href);url.searchParams.set('lang',value);location.replace(url.href);
  }
  return true;
}
if(globalThis.document){
  document.documentElement.lang=selected;
  document.querySelector('.skip-link')?.replaceChildren(t('Ir al contenido'));
  document.querySelector('.boot p')?.replaceChildren(t('Preparando tu taller…'));
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-language]');
    if(button&&button.dataset.language!==selected){event.preventDefault();setLanguage(button.dataset.language);}
  });
  // Browser validation text follows the operating system otherwise, rather than EN/ES.
  document.addEventListener('invalid',event=>{
    const field=event.target;if(typeof field.setCustomValidity!=='function')return;
    field.setCustomValidity(field.validity.valueMissing?t('Completa este campo.'):t('Revisa el valor de este campo.'));
  },true);
  for(const type of ['input','change'])document.addEventListener(type,event=>event.target.setCustomValidity?.(''),true);
}
