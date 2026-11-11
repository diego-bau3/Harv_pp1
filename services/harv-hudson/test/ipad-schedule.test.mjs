import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorSchedule,operatorClock,operatorDuration,operatorState} from '../public/ipad-state.js';

const minute=60000,now=new Date(2026,8,30,12,0).getTime();
function fixture(model='A1') {
  return {
    p:{model,telemetry:{fresh:true,status:'printing',progress:20,remainingMinutes:30,lastSeenAt:new Date(now).toISOString(),currentJob:{name:'active-print'}}},
    q:{active:{job:{label:'Current'},attempt:{state:'printing'},startOperation:{status:'confirmed',packet:{print:{subtask_name:'active-print'}}}},pending:[
      {id:'first',libraryId:'file-1',plate:2,materialPlan:{state:'ready'}},
      {id:'second',libraryId:'file-2',plate:1,materialPlan:{state:'ready'}}]},
    files:[{id:'file-1',plates:[{index:1,predictedSeconds:300},{index:2,predictedSeconds:3600}]},{id:'file-2',plates:[{index:1,predictedSeconds:2700}]}]
  };
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('all printer models forecast in existing queue order with five minutes between prints, without mutating input',()=>{
  for(const model of ['P1S','A1','X1C','X2D']) {
    const f=freeze(fixture(model)),before=JSON.stringify(f),s=operatorSchedule(f.p,f.q,f.files,now);
    assert.equal(s.current.at,now+30*minute);
    assert.deepEqual(s.pending.map(j=>[j.jobId,j.startAt,j.endAt]),[
      ['first',now+35*minute,now+95*minute],['second',now+100*minute,now+145*minute]
    ]);
    assert.equal(s.cleanupMinutes,5);assert.equal(JSON.stringify(f),before);
  }
});

test('idle printers forecast the first job from now, with no initial cleaning delay or change to Start eligibility',()=>{
  const f=fixture();f.q.active=null;f.p.telemetry.status='idle';
  const before=operatorState(f.p,f.q),s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.current,null);assert.equal(s.pending[0].startAt,now);assert.equal(s.pending[0].endAt,now+60*minute);
  assert.equal(s.pending[1].endAt,now+110*minute);assert.equal(before.canStart,true);
  assert.deepEqual(operatorState(f.p,f.q),before);
});

test('a completed job uses its recorded finish time, accounts for elapsed cleanup and never adds a mandatory wait',()=>{
  const f=fixture();f.p.telemetry.status='finished';f.q.active.attempt={state:'awaiting_collection',outcome:'finished',endedAt:new Date(now-3*minute).toISOString()};
  let s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.current.at,now-3*minute);assert.equal(s.current.estimated,false);assert.equal(s.current.label,'Terminó');
  assert.equal(s.pending[0].startAt,now+2*minute);
  s=operatorSchedule(f.p,f.q,f.files,now+10*minute);
  assert.equal(s.pending[0].startAt,now+10*minute);
  f.q.active=null;s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.pending[0].startAt,now);assert.equal(operatorState(f.p,f.q).canStart,true);
});

test('paused, offline, unmatched and review attempts do not borrow a remaining time or invent queue finish times',()=>{
  for(const change of [f=>f.p.telemetry.status='paused',f=>f.p.telemetry.fresh=false,f=>f.p.telemetry.currentJob.name='other',f=>f.q.active.attempt.state='review']){
    const f=fixture();change(f);const s=operatorSchedule(f.p,f.q,f.files,now);
    assert.equal(s.current.at,null);assert.ok(s.current.detail);
    assert.ok(s.pending.every(j=>j.endAt===null&&j.reason));
  }
  const f=fixture();assert.equal(operatorSchedule(f.p,f.q,f.files,now,false).current.at,null);
});

test('missing, invalid or zero unfinished remaining times and missing queued durations propagate uncertainty',()=>{
  for(const remaining of [null,undefined,NaN,-1,0]) {
    const f=fixture();f.p.telemetry.remainingMinutes=remaining;
    assert.equal(operatorSchedule(f.p,f.q,f.files,now).pending[0].endAt,null);
  }
  const f=fixture();f.files[0].plates[1].predictedSeconds=null;
  const s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.current.at,now+30*minute);assert.equal(s.pending[0].durationMs,null);
  assert.equal(s.pending[1].endAt,null);assert.equal(s.pending[1].durationMs,45*minute);
});

test('filament blockers prevent an unconditional schedule for that job and those behind it',()=>{
  const f=fixture();f.q.pending[1].materialPlan.state='blocked';
  const s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.pending[0].endAt,now+95*minute);assert.equal(s.pending[1].endAt,null);
  assert.match(s.pending[1].reason,/filamento/);
});

test('live external prints contribute remaining time without being adopted or given an invented historical end time',()=>{
  const f=fixture();f.q.active=null;
  assert.equal(operatorSchedule(f.p,f.q,f.files,now).pending[0].endAt,now+95*minute);
  f.p.telemetry.status='finished';const s=operatorSchedule(f.p,f.q,f.files,now);
  assert.equal(s.current.at,null);assert.equal(s.current.detail,'Hora no registrada');assert.equal(f.q.active,null);
});

test('time display includes tomorrow or a date after midnight and durations preserve partial minutes',()=>{
  const late=new Date(2026,8,30,23,50).getTime();
  assert.match(operatorClock(late+30*minute,late),/^Mañana · /);
  assert.doesNotMatch(operatorClock(late,late),/Mañana/);
  assert.match(operatorClock(late+49*60*minute,late),/oct/);
  assert.equal(operatorClock(null,late),'Por confirmar');
  assert.equal(operatorDuration(8969000),'2 h 30 min');assert.equal(operatorDuration(3600000),'1 h');
});
