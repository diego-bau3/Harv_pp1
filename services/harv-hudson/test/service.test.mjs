import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,startInput,fresh,FakeTransport,fakeVault } from './helpers.mjs';
import { HudsonService } from '../src/service.mjs';

test('a double request does not send a second start; acknowledgement is not physical confirmation',async t=>{
  const f=await fixture(t);
  const first=await f.service.command(f.printer.id,'start',startInput,'start-key-01');
  assert.equal(first.status,'sent');assert.equal(f.transport.calls.length,1);
  f.service.handleAck(f.printer.id,{command:'project_file',sequence_id:first.sequence,result:'success'});
  assert.equal(f.store.operation(first.id).status,'acknowledged');
  const again=await f.service.command(f.printer.id,'start',startInput,'start-key-01');
  assert.equal(again.id,first.id);assert.equal(f.transport.calls.length,1);
  await assert.rejects(f.service.command(f.printer.id,'start',{...startInput,plate:2},'start-key-01'),{code:'KEY_REUSED'});
  await assert.rejects(f.service.command(f.printer.id,'start',startInput,'start-key-02'),{code:'UNRESOLVED_COMMAND'});
  f.service.reconcile(f.printer.id,fresh({status:'printing',currentJob:{name:'someone-elses-print',file:''}}));
  assert.equal(f.store.operation(first.id).status,'acknowledged');
  f.service.reconcile(f.printer.id,fresh({status:'printing',currentJob:{name:first.packet.print.subtask_name,file:''}}));
  assert.equal(f.store.operation(first.id).status,'confirmed');
});
test('start requires fresh idle state and physical setup, correct model, nozzle and AMS',async t=>{
  const f=await fixture(t);
  for(const patch of [{fresh:false},{status:'printing'},{status:'unknown'},{errors:{printError:123}}]) {
    f.transport.states.set(f.printer.id,fresh(patch));
    await assert.rejects(f.service.command(f.printer.id,'start',startInput,'invalid-01'));
  }
  f.transport.states.set(f.printer.id,fresh());
  await assert.rejects(f.service.command(f.printer.id,'start',{...startInput,bedCleared:false},'invalid-02'),{code:'SETUP_REQUIRED'});
  await assert.rejects(f.service.command(f.printer.id,'start',{...startInput,amsMapping:[2]},'invalid-03'),{code:'AMS_SLOT'});
  f.transfer.archive.plates[0].model='A1';f.store.saveTransfer(f.transfer);
  await assert.rejects(f.service.command(f.printer.id,'start',startInput,'invalid-04'),{code:'WRONG_MODEL'});
  f.transfer.archive.plates[0].model='P1S';f.transfer.archive.plates[0].nozzleDiameters=[0.6];f.store.saveTransfer(f.transfer);
  await assert.rejects(f.service.command(f.printer.id,'start',startInput,'invalid-05'),{code:'WRONG_NOZZLE'});
  assert.equal(f.transport.calls.length,0);
});
test('network ambiguity is persisted and never automatically retried after restart',async t=>{
  const f=await fixture(t);f.transport.failPublish=true;
  const op=await f.service.command(f.printer.id,'start',startInput,'uncertain-01');assert.equal(op.status,'uncertain');
  await f.service.close();
  const nextTransport=new FakeTransport();
  const next=new HudsonService({store:f.store,transport:nextTransport,vault:fakeVault,config:f.config});
  t.after(()=>next.close());await next.initialize();
  assert.equal(nextTransport.calls.length,0);
  await assert.rejects(next.command(f.printer.id,'start',startInput,'uncertain-02'),{code:'UNRESOLVED_COMMAND'});
  next.resolve(f.printer.id,op.id,{printerChecked:true,note:'Se verificó detenida y cama libre.'});
  assert.equal(f.store.operation(op.id).status,'resolved');
});
test('in-flight sent operations recover as uncertain and late telemetry can reconcile them',async t=>{
  const f=await fixture(t);const op=await f.service.command(f.printer.id,'start',startInput,'recover-01');
  f.store.recover();assert.equal(f.store.operation(op.id).status,'uncertain');
  f.service.reconcile(f.printer.id,fresh({status:'finished',currentJob:{name:op.packet.print.subtask_name,file:''}}));
  assert.equal(f.store.operation(op.id).status,'confirmed');
});
test('simultaneous different starts serialize before publishing',async t=>{
  const f=await fixture(t);let release;f.transport.delay=new Promise(resolve=>release=resolve);
  const first=f.service.command(f.printer.id,'start',startInput,'parallel-01');
  await assert.rejects(f.service.command(f.printer.id,'start',startInput,'parallel-02'),{code:'BUSY'});
  release();await first;assert.equal(f.transport.calls.length,1);
});
test('pause/resume/stop require matching states; failed stop is not marked successful',async t=>{
  const f=await fixture(t);f.transport.states.set(f.printer.id,fresh({status:'printing'}));
  const pause=await f.service.command(f.printer.id,'pause',{},'pause-0001');
  f.service.reconcile(f.printer.id,fresh({status:'paused'}));assert.equal(f.store.operation(pause.id).status,'confirmed');
  f.transport.states.set(f.printer.id,fresh({status:'paused'}));
  const resume=await f.service.command(f.printer.id,'resume',{},'resume-001');
  f.service.reconcile(f.printer.id,fresh({status:'printing'}));assert.equal(f.store.operation(resume.id).status,'confirmed');
  f.transport.states.set(f.printer.id,fresh({status:'printing'}));
  const stop=await f.service.command(f.printer.id,'stop',{},'stop-00001');
  f.service.handleAck(f.printer.id,{command:'stop',sequence_id:stop.sequence,result:'fail',reason:'busy'});
  assert.equal(f.store.operation(stop.id).status,'rejected');
});
test('timeout leaves an operation uncertain, and stale telemetry cannot resolve it',async t=>{
  const f=await fixture(t);const op=await f.service.command(f.printer.id,'start',startInput,'timeout-01');
  f.store.saveOperation({...op,createdAt:new Date(Date.now()-6000).toISOString()});f.service.expire();
  assert.equal(f.store.operation(op.id).status,'uncertain');
  f.service.reconcile(f.printer.id,fresh({fresh:false,status:'printing',currentJob:{name:op.packet.print.subtask_name,file:''}}));
  assert.equal(f.store.operation(op.id).status,'uncertain');
});
test('registration rejects public targets, duplicate addresses and missing nozzle information',async t=>{
  const f=await fixture(t);const input={serial:'OTHERPRINTER',model:'A1',accessCode:'test-code',nozzleDiameters:[0.4]};
  await assert.rejects(f.service.register({...input,ipAddress:'8.8.8.8'}),{code:'INVALID_IP'});
  await assert.rejects(f.service.register({...input,ipAddress:f.printer.ipAddress}),{code:'DUPLICATE_IP'});
  await assert.rejects(f.service.register({...input,ipAddress:'192.168.1.11',nozzleDiameters:[]}),{code:'NOZZLE'});
  assert.ok(!JSON.stringify(f.service.list()).includes('test-code'));
});
