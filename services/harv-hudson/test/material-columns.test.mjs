import test from 'node:test';
import assert from 'node:assert/strict';
import {spoolMaterialGroups,createIpadInventory} from '../public/ipad-inventory.js';
import {setLanguage} from '../public/i18n.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('groups every active spool without merging material variants or changing stored inventory',()=>{
  const spools=['PLA',' pla ','PVA','PLA SILK','PETG','ABS','PLA + CF','PA612-CF15','TPU','ASA','HIPS','   ',null].map((material,i)=>({id:String(i),material}));
  spools.push({id:'archived',material:'PC',archived:true});
  const before=JSON.stringify(spools),groups=spoolMaterialGroups(spools);
  assert.deepEqual(groups.slice(0,8).map(g=>g.material),['PVA','PLA','ABS','PETG','TPU','PLA SILK','PLA + CF','PA612-CF15']);
  assert.deepEqual(groups.find(g=>g.material==='PLA').spools.map(s=>s.id),['0','1']);
  assert.deepEqual(groups.find(g=>g.material==='').spools.map(s=>s.id),['11','12']);
  assert.equal(groups.flatMap(g=>g.spools).length,13);
  assert(groups.some(g=>g.material==='ASA'));assert(groups.some(g=>g.material==='HIPS'));
  assert.equal(JSON.stringify(spools),before);
});

test('the grouped picker keeps one shared selection, escapes data, and resets physical confirmation when changing materials',()=>{
  for(const lang of ['es','en']){
    setLanguage(lang,{reload:false});
    try{
      const p={id:'p',name:'Printer',model:'P1S',enforceFilamentChecks:false,telemetry:{fresh:true,status:'idle',slots:[{source:'external',amsId:254,slotId:0,empty:true}]}};
      const spools=[{id:'pla',name:'BlancoM01',material:'PLA',brand:'Mexico Makers',color:'#FFFFFF',remainingGrams:800},
        {id:'petg',name:'NegroE01',material:'PETG',brand:'Elegoo',color:'#000000',remainingGrams:500},
        {id:'custom',name:'<img src=x>',material:'<custom>',brand:'<brand>',remainingGrams:0,stockUncertain:true},
        {id:'in-use',name:'Busy',material:'TPU',mount:{printerId:'other',source:'ams',amsId:0,slotId:0}},
        {id:'old',name:'Archived',material:'ASA',archived:true}];
      const state={connected:true,data:{printers:[p],queues:[],inventory:{spools}}};
      const before=JSON.stringify(state);let args,writes=0,change;
      const ui=createIpadInventory({state,esc,openForm:(...a)=>args=a,mutate:()=>writes++});
      ui.change('p','external:254:0');
      const html=args[1];
      assert.equal((html.match(/name="spoolId"/g)||[]).length,5);
      assert.doesNotMatch(html,/Archived|<img|<custom>|<brand>|<select/);
      assert.match(html,/&lt;CUSTOM&gt;/);assert.match(html,/&lt;img src=x&gt;/);
      assert.match(html,/value="in-use"[^>]*disabled/);
      assert.doesNotMatch(html,/value="custom"[^>]*disabled/);
      assert.match(html,lang==='en'?/Select the spool you are going to load\./:/Selecciona la bobina que vas a colocar\./);
      assert.match(html,lang==='en'?/Leave position empty/:/Dejar posición vacía/);
      const check={checked:true},label={textContent:''},confirmation={};let moved;
      args[3].after({elements:{confirmed:check},closest:()=>({classList:{add(){}}}),
        querySelector:s=>s==='.dialog-footer'?{prepend:el=>moved=el}:s==='.material-picker-confirm'?confirmation:label,
        addEventListener:(type,fn)=>change=fn});
      assert.equal(moved,confirmation);
      change({target:{name:'spoolId',value:'petg'}});
      assert.equal(check.checked,false);assert.match(label.textContent,/NegroE01/);
      assert.equal(writes,0);assert.equal(JSON.stringify(state),before);
    }finally{setLanguage('es',{reload:false});}
  }
});
