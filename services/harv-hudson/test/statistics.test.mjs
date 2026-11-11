import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStatistics,readStatistics} from '../src/statistics.mjs';
import {createStatistics} from '../public/statistics.js';
import {setLanguage} from '../public/i18n.js';
import {createApi} from '../src/api.mjs';
import {fixture} from './helpers.mjs';

const now=new Date('2026-11-05T18:00:00Z');
const printers=[{id:'p',name:'P1S',model:'P1S'},{id:'q',name:'A1 <script>',model:'A1'}];
function row(id,overrides={}){return {attempt:{id,printerId:'p',state:'collected',observedStartedAt:'2026-10-10T10:00:00Z',endedAt:'2026-10-10T12:00:00Z'},collection:{good:3,rejected:1,unproduced:0,outcome:'finished',at:'2026-10-11T12:00:00Z'},usage:{status:'settled',method:'slicer-total',totalGrams:100},...overrides};}
const stats=(rows,query={period:'month',month:'2026-10'})=>buildStatistics({rows,printers},query,now);

test('counts only inspected pieces, keeps failed consumption and does not invent missing data',()=>{
 const rows=[row('ok'),row('failed',{collection:{good:0,rejected:4,unproduced:0,outcome:'failed',at:'2026-10-11T12:00:00Z'},usage:{status:'settled',method:'measured',totalGrams:50}}),row('unknown',{usage:{status:'untracked'}}),row('empty',{attempt:{id:'empty',printerId:'p',state:'collected',notStartedConfirmedAt:'2026-10-10T12:00:00Z'},collection:{good:0,rejected:0,unproduced:4,outcome:'aborted',at:'2026-10-10T12:00:00Z'},usage:{status:'settled',method:'no-start',totalGrams:0}}),row('pending',{attempt:{...row('p').attempt,state:'awaiting_collection'},collection:null})];
 const result=stats(rows);assert.equal(result.totals.good,6);assert.equal(result.totals.rejected,6);assert.equal(result.totals.grams,250);assert.equal(result.totals.estimatedGrams,200);assert.equal(result.totals.measuredGrams,50);assert.equal(result.totals.missingMaterial,1);assert.equal(result.totals.seconds,8*3600);assert.equal(result.totals.awaitingCollection,1);assert.equal(result.totals.aborted,1);
});
test('splits a print across Mexico City month/year boundaries, excluding collection waiting',()=>{
 const a=row('boundary');a.attempt.observedStartedAt='2027-01-01T05:00:00Z';a.attempt.endedAt='2027-01-01T07:00:00Z';a.collection.at='2027-01-04T12:00:00Z';
 const make=query=>buildStatistics({rows:[a],printers},query,new Date('2027-01-05T12:00:00Z'));
 const dec=make({period:'month',month:'2026-12'}),jan=make({period:'month',month:'2027-01'}),all=make({period:'all'});
 assert.equal(dec.totals.seconds,3600);assert.equal(dec.totals.good,0);assert.equal(jan.totals.seconds,3600);assert.equal(jan.totals.good,3);assert.equal(all.totals.seconds,7200);assert.equal(all.buckets.reduce((n,b)=>n+b.seconds,0),7200);
});
test('daily totals use Mexico City midnight and split hours without duplicating pieces or material',()=>{
 const overnight=row('overnight');overnight.attempt.observedStartedAt='2026-11-04T05:00:00Z';overnight.attempt.endedAt='2026-11-04T07:00:00Z';overnight.collection.at='2026-11-05T12:00:00Z';
 const before=row('before');before.attempt.observedStartedAt='2026-11-04T04:00:00Z';before.attempt.endedAt='2026-11-04T05:59:59Z';
 const next=row('next');next.attempt.observedStartedAt='2026-11-05T06:00:00Z';next.attempt.endedAt='2026-11-05T07:00:00Z';
 const result=stats([overnight,before,next],{period:'day',day:'2026-11-04'});
 assert.equal(result.day,'2026-11-04');assert.equal(result.start,'2026-11-04T06:00:00.000Z');assert.equal(result.end,'2026-11-05T06:00:00.000Z');assert.equal(result.buckets.length,24);
 assert.equal(result.totals.good,3);assert.equal(result.totals.rejected,1);assert.equal(result.totals.grams,100);assert.equal(result.totals.seconds,3600);
 assert.equal(result.buckets[0].seconds,3600);assert.equal(result.buckets[1].good,3);assert.equal(result.buckets.reduce((n,b)=>n+b.good,0),3);assert.equal(result.buckets.reduce((n,b)=>n+b.seconds,0),result.totals.seconds);
 const prior=stats([overnight],{period:'day',day:'2026-11-03'});assert.equal(prior.totals.good,0);assert.equal(prior.totals.grams,0);assert.equal(prior.totals.seconds,3600);
 const other=stats([overnight],{period:'day',day:'2026-11-04',printer:'q'});assert.equal(other.totals.good,0);assert.equal(other.totals.seconds,0);
});
test('day defaults to today in the workshop zone and validates leap days and historical DST',()=>{
 const make=(query,at='2026-11-05T05:00:00Z')=>buildStatistics({rows:[],printers},query,new Date(at));
 assert.equal(make({period:'day'}).day,'2026-11-04');
 assert.equal(make({period:'day',day:'2024-02-29'}).buckets.length,24);
 for(const day of ['2026-02-29','2026-04-31','2026-11-00','2026-13-01','2026-11-4','bad'])assert.throws(()=>make({period:'day',day}),{code:'STATS_DATE'});
 const short=make({period:'day',day:'2021-04-04'}),long=make({period:'day',day:'2021-10-31'});
 assert.equal(short.buckets.length,23);assert.equal(long.buckets.length,25);assert.equal(new Set(long.buckets.map(b=>b.key)).size,25);
});
test('month boundaries use the workshop zone, missing timestamps stay missing, invalid and future intervals excluded',()=>{
 const missing=row('missing',{attempt:{id:'missing',printerId:'q',state:'collected'},usage:null});
 const before=row('before');before.attempt.endedAt='2026-10-01T05:59:59Z';before.attempt.observedStartedAt='2026-10-01T04:00:00Z';
 const result=stats([missing,before]);assert.equal(result.totals.good,3);assert.equal(result.totals.seconds,0);assert.equal(result.totals.missingTime,1);assert.equal(result.totals.missingMaterial,1);
 const filtered=stats([row('ok'),missing],{period:'all',printer:'q'});assert.equal(filtered.totals.good,3);assert.equal(filtered.byPrinter.length,1);assert.equal(filtered.byPrinter[0].id,'q');
 assert.throws(()=>stats([],{period:'week'}),{code:'STATS_PERIOD'});assert.throws(()=>stats([],{month:'2026-99'}),{code:'STATS_DATE'});assert.throws(()=>stats([],{printer:'not-a-printer'}),{code:'STATS_PRINTER'});
});
test('reads full history beyond 200 jobs and uses the current corrected usage once without writes',async t=>{
 const f=await fixture(t);for(let i=0;i<205;i++){const a=row(String(i));a.attempt.printerId=f.printer.id;a.attempt.jobId='job-'+i;f.store.saveAttempt(a.attempt);f.store.saveCollection({...a.collection,attemptId:a.attempt.id,printerId:f.printer.id});f.store.saveUsage({...a.usage,attemptId:a.attempt.id,totalGrams:i===0?20:100,revision:i===0?4:1});}
 const changes=f.store.db.prepare('SELECT total_changes() AS n').get().n;
 const r=readStatistics(f.store,{period:'all'},now);assert.equal(r.totals.good,615);assert.equal(r.totals.grams,20420);assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n,changes);assert.equal(f.transport.calls.length,0);
});
test('statistics endpoint requires authorization, validates filters and never calls the printers',async t=>{
 const f=await fixture(t),server=createApi({...f,token:'stats-test-token',discovery:async()=>[]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer stats-test-token'};
 assert.equal((await fetch(base+'/api/statistics')).status,401);
 assert.equal((await fetch(base+'/api/statistics?period=week',{headers})).status,400);
 assert.equal((await fetch(base+'/api/statistics?period=day&day=2026-02-30',{headers})).status,400);
 const dayResponse=await fetch(base+'/api/statistics?period=day&day=2026-11-04',{headers});assert.equal(dayResponse.status,200);const daily=await dayResponse.json();assert.equal(daily.period,'day');assert.equal(daily.day,'2026-11-04');assert.equal(daily.buckets.length,24);
 const response=await fetch(base+'/api/statistics?period=all',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.totals.good,0);assert.equal(data.printers.length,1);assert.ok(!JSON.stringify(data).includes('test-code'));assert.equal(f.transport.calls.length,0);
 for(const asset of ['/statistics.js','/statistics.css'])assert.equal((await fetch(base+asset)).status,200);
});
test('statistics UI supports ES/EN, filters and zero/missing data without HTML injection',async()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 for(const lang of ['es','en']){setLanguage(lang,{reload:false});try{
  const requests=[],view=createStatistics({esc,header:(a,b)=>`<h1>${a}</h1><p>${b}</p>`,repaint(){},api:async route=>{requests.push(route);return stats([row('one',{usage:null})],Object.fromEntries(new URL(route,'http://localhost').searchParams));}});
  view.change('month','2026-10');await view.reload();const html=view.render();assert.match(html,lang==='en'?/Statistics/:/Estadísticas/);assert.match(html,/A1 &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-stat-filter="printer"/);assert.match(html,/statistics-bar-track/);assert.match(html,lang==='en'?/subtotal/:/subtotal/);
  view.change('period','all');await view.reload();assert.ok(requests.at(-1).includes('period=all'));view.change('printer','q');await view.reload();assert.ok(requests.at(-1).includes('printer=q'));assert.ok(requests.every(r=>r.startsWith('/api/statistics?')));
  view.change('period','day');view.change('day','2026-11-04');await view.reload();assert.ok(requests.at(-1).includes('period=day'));assert.ok(requests.at(-1).includes('day=2026-11-04'));assert.match(view.render(),/type="date"/);assert.match(view.render(),/value="2026-11-04"/);assert.match(view.render(),lang==='en'?/Parts by hour/:/Piezas por hora/);assert.match(view.render(),/00:00/);assert.match(view.render(),/23:00/);
  const requestCount=requests.length;view.change('day','2026-02-30');assert.equal(requests.length,requestCount);
 }finally{setLanguage('es',{reload:false});}}
});
test('a slower previous filter response cannot overwrite the selected period',async()=>{
 let resolveFirst,call=0;const view=createStatistics({esc:String,header:a=>a,repaint(){},api:()=>++call===1?new Promise(r=>resolveFirst=r):Promise.resolve(stats([],{period:'all'}))});
 const first=view.reload();view.change('period','all');await view.reload();resolveFirst(stats([row('stale')]));await first;assert.match(view.render(),/statistics-empty/);
});
