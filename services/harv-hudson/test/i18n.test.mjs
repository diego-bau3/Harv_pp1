import test from 'node:test';
import assert from 'node:assert/strict';
import {english,spanish} from '../public/translations.js';
import {t,ht,locale,language,setLanguage,translateMessage,languageSelector} from '../public/i18n.js';

test('translations preserve every dynamic placeholder, including repeated ones',()=>{
  const placeholders=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  for(const catalog of [english,spanish])for(const [source,translated]of Object.entries(catalog))
    assert.deepEqual(placeholders(translated),placeholders(source),source);
});
test('EN / ES preserves opaque names and escaped markup, and changes labels and locale only',()=>{
  const name='Negro &lt;script&gt; {0}';
  try{
    setLanguage('en',{reload:false});
    assert.equal(language(),'en');assert.equal(locale(),'en-US');
    assert.equal(t('Producción'),'Production');
    assert.equal(ht`Ver placa ${4} · ${name}`,`View plate 4 · ${name}`);
    assert.match(languageSelector(),/data-language="en"[^>]*aria-pressed="true"/);
    assert.equal(translateMessage('El archivo supera los 512 MB.'),'The file exceeds 512 MB.');
    setLanguage('es',{reload:false});
    assert.equal(t('Producción'),'Producción');assert.equal(locale(),'es-MX');
    assert.equal(t('Start'),'Iniciar');
    assert.equal(ht`Ver placa ${4} · ${name}`,`Ver placa 4 · ${name}`);
    assert.equal(setLanguage('fr',{reload:false}),false);assert.equal(language(),'es');
  }finally{setLanguage('es',{reload:false});}
});
test('language selection persists per browser, retains the page and never touches production endpoints',async()=>{
  const saved=new Map();let next;
  globalThis.localStorage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
  globalThis.location={href:'http://127.0.0.1:8788/?desktop=1&shell=1#inventory',replace:url=>{next=url;}};
  try{
    const first=await import('../public/i18n.js?preference-one');
    assert.equal(first.language(),'es');first.setLanguage('en');
    const url=new URL(next);assert.equal(url.hash,'#inventory');assert.equal(url.searchParams.get('shell'),'1');
    assert.equal(url.searchParams.get('lang'),'en');
    const second=await import('../public/i18n.js?preference-two');assert.equal(second.language(),'en');
    location.href='http://127.0.0.1:8788/?lang=es#production';
    const native=await import('../public/i18n.js?preference-three');assert.equal(native.language(),'es');
    assert.equal(saved.get('hudson.language'),'es');
  }finally{delete globalThis.localStorage;delete globalThis.location;}
});
