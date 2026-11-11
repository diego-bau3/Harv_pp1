import { requireThat } from './errors.mjs';

export const workshopTimeZone='America/Mexico_City';
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:workshopTimeZone,year:'numeric',month:'2-digit',day:'2-digit'});
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:workshopTimeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const parts=(formatter,date)=>Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const dateKey=ms=>{const p=parts(calendar,new Date(ms));return `${p.year}-${p.month}-${p.day}`;};
const time=value=>{const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?n:null;};
// Convert workshop calendar boundaries to UTC, including historical DST.
function boundary(year,month=1,day=1){
  const target=Date.UTC(year,month-1,day);let result=target;
  for(let i=0;i<4;i++){const p=parts(clock,new Date(result));const delta=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);result+=delta;if(!delta)break;}
  return result;
}
const metrics=()=>({good:0,rejected:0,unproduced:0,collections:0,aborted:0,grams:0,estimatedGrams:0,measuredGrams:0,usageRecords:0,missingMaterial:0,partialMaterial:0,seconds:0,timedAttempts:0,missingTime:0,awaitingCollection:0});
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const validDay=value=>/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export function buildStatistics({rows,printers},query={},now=new Date()){
  const today=dateKey(now.getTime()),period=query.period||'month',day=query.day||today,month=query.month||today.slice(0,7),year=String(query.year||today.slice(0,4)),printerId=query.printer||'all';
  requireThat(['day','month','year','all'].includes(period),'STATS_PERIOD','Selecciona día, mes, año o todo el historial.');
  requireThat(validDay(day)&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)&&/^20\d{2}$/.test(year),'STATS_DATE','Selecciona una fecha válida entre 2000 y 2099.');
  const known=new Map(printers.map(p=>[p.id,{id:p.id,name:p.name,model:p.model}]));
  for(const r of rows)if(!known.has(r.attempt.printerId))known.set(r.attempt.printerId,{id:r.attempt.printerId,name:'',model:''});
  requireThat(printerId==='all'||known.has(printerId),'STATS_PRINTER','Impresora no encontrada.',404);
  const closed=rows.filter(r=>r.collection||r.attempt.state==='awaiting_collection'||r.attempt.state==='collected'||r.attempt.notStartedConfirmedAt);
  const dates=closed.flatMap(r=>[time(r.attempt.endedAt),time(r.collection?.at),time(r.attempt.observedStartedAt),time(r.attempt.notStartedConfirmedAt)]).filter(v=>v!==null&&v<=now.getTime());
  const firstYear=Math.min(+today.slice(0,4),...dates.map(v=>+dateKey(v).slice(0,4)));
  const availableYears=Array.from({length:+today.slice(0,4)-firstYear+1},(_,i)=>+today.slice(0,4)-i);
  const y=period==='month'?+month.slice(0,4):+year,m=+month.slice(5,7);
  const start=period==='day'?boundary(+day.slice(0,4),+day.slice(5,7),+day.slice(8,10)):period==='month'?boundary(y,m):period==='year'?boundary(y):boundary(firstYear);
  const end=period==='day'?boundary(+day.slice(0,4),+day.slice(5,7),+day.slice(8,10)+1):period==='month'?boundary(y,m+1):period==='year'?boundary(y+1):boundary(+today.slice(0,4)+1);
  let buckets;
  if(period==='day')buckets=Array.from({length:Math.ceil((end-start)/3600000)},(_,i)=>({key:new Date(start+i*3600000).toISOString(),start:start+i*3600000,end:Math.min(end,start+(i+1)*3600000),...metrics()}));
  else if(period==='month')buckets=Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>({key:`${month}-${String(i+1).padStart(2,'0')}`,start:boundary(y,m,i+1),end:boundary(y,m,i+2),...metrics()}));
  else if(period==='year')buckets=Array.from({length:12},(_,i)=>({key:`${year}-${String(i+1).padStart(2,'0')}`,start:boundary(y,i+1),end:boundary(y,i+2),...metrics()}));
  else buckets=[...availableYears].reverse().map(v=>({key:String(v),start:boundary(v),end:boundary(v+1),...metrics()}));
  const totals=metrics(),byPrinter=new Map([...known.values()].filter(p=>printerId==='all'||p.id===printerId).map(p=>[p.id,{...p,...metrics()}]));
  let undated=0;
  for(const {attempt:a,collection:c,usage:u} of closed){
    if(printerId!=='all'&&a.printerId!==printerId)continue;
    const noStart=!!a.notStartedConfirmedAt||u?.method==='no-start';
    const finished=time(a.endedAt)??time(c?.at)??time(a.collectedAt)??time(a.notStartedConfirmedAt);
    const began=time(a.observedStartedAt),ended=time(a.endedAt);
    const validTime=!noStart&&began!==null&&ended!==null&&ended>=began&&ended<=now.getTime();
    const p=byPrinter.get(a.printerId);
    if(finished===null){undated++;continue;}
    if(finished>=start&&finished<end&&finished<=now.getTime()){
      const b=buckets.find(b=>finished>=b.start&&finished<b.end),targets=[totals,p,b].filter(Boolean);
      const validUsage=u?.status==='settled'&&typeof u.totalGrams==='number'&&Number.isFinite(u.totalGrams)&&u.totalGrams>=0;
      for(const t of targets){
        if(c){t.collections++;t.good+=count(c.good);t.rejected+=count(c.rejected);t.unproduced+=count(c.unproduced);if(c.outcome==='aborted')t.aborted++;}
        else if(a.state==='awaiting_collection')t.awaitingCollection++;
        if(noStart){t.usageRecords++;}
        else if(validUsage){t.usageRecords++;t.grams+=u.totalGrams;t[u.method==='measured'?'measuredGrams':'estimatedGrams']+=u.totalGrams;if(u.trackingIncomplete)t.partialMaterial++;}
        else t.missingMaterial++;
        if(!validTime&&!noStart)t.missingTime++;
      }
    }
    // Split elapsed time across calendar boundaries; collection waiting is excluded.
    if(validTime&&ended>start&&began<end){
      const seconds=Math.max(0,Math.min(ended,end)-Math.max(began,start))/1000;
      for(const t of [totals,p]){t.seconds+=seconds;t.timedAttempts++;}
      for(const b of buckets)if(ended>b.start&&began<b.end){b.seconds+=Math.max(0,Math.min(ended,b.end)-Math.max(began,b.start))/1000;b.timedAttempts++;}
    }
  }
  return {period,day,month,year:+year,printerId,timeZone:workshopTimeZone,generatedAt:now.toISOString(),start:new Date(start).toISOString(),end:new Date(end).toISOString(),availableYears,printers:[...known.values()],totals,byPrinter:[...byPrinter.values()],buckets:buckets.map(({start,end,...b})=>b),undated};
}

export function readStatistics(store,query={},now=new Date()){
  // One joined snapshot, full history, latest corrected usage, no ledger summing or writes.
  const rows=store.db.prepare(`SELECT a.data AS attempt,c.data AS collection,u.data AS usage FROM attempts a
    LEFT JOIN collections c ON c.attempt_id=a.id LEFT JOIN material_usage u ON u.attempt_id=a.id`).all()
    .map(r=>({attempt:JSON.parse(r.attempt),collection:r.collection?JSON.parse(r.collection):null,usage:r.usage?JSON.parse(r.usage):null}));
  return buildStatistics({rows,printers:store.printers()},query,now);
}
