import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixture,fakeVault } from './helpers.mjs';
import { BambuTransport } from '../src/transport.mjs';
import { WindowsVault } from '../src/secrets.mjs';
import { Store } from '../src/store.mjs';

class MockMqtt extends EventEmitter {
  constructor(){super();this.connected=true;this.sent=[];}
  subscribe(topic,options,callback){this.topic=topic;callback(null);}
  publish(topic,payload,options,callback){this.sent.push({topic,packet:JSON.parse(payload),options});callback(null);}
  async endAsync(){this.connected=false;}
}
test('MQTT reconnect waits for new state and acknowledgements do not refresh stale telemetry',async t=>{
  const f=await fixture(t);const client=new MockMqtt();let settings;
  const transport=new BambuTransport({...f,vault:fakeVault,mqttConnect:options=>{settings=options;return client;}});
  t.after(()=>transport.close());await transport.connect(f.printer);client.emit('connect');
  assert.equal(settings.queueQoSZero,false);assert.equal(settings.protocol,'mqtts');assert.equal(settings.password,'test-code');
  assert.ok(client.sent.some(s=>s.packet.pushing?.command==='pushall'));
  assert.equal(transport.status(f.printer.id).fresh,false);
  const emit=message=>client.emit('message',`device/${f.printer.serial}/report`,Buffer.from(JSON.stringify(message)));
  emit({print:{gcode_state:'RUNNING',mc_percent:20,mc_remaining_time:50}});assert.equal(transport.status(f.printer.id).fresh,true);
  emit({print:{mc_percent:21}});assert.equal(transport.status(f.printer.id).remainingMinutes,50);
  const seen=transport.status(f.printer.id).stateSeenAt;
  emit({print:{command:'project_file',sequence_id:'1',result:'success'}});assert.equal(transport.status(f.printer.id).stateSeenAt,seen);
  client.emit('close');assert.equal(transport.status(f.printer.id).fresh,false);
  client.emit('connect');emit({print:{mc_percent:22}});assert.equal(transport.status(f.printer.id).fresh,false);
  emit({print:{gcode_state:'FINISH'}});assert.equal(transport.status(f.printer.id).status,'finished');
  assert.equal(transport.status(f.printer.id).requiresCollection,true);
  await transport.publish(f.printer.id,{print:{command:'pause',sequence_id:'20001'}});
  assert.equal(client.sent.at(-1).options.qos,0);assert.equal(client.sent.at(-1).options.retain,false);
});
test('FTPS uses implicit TLS, closes on failure, and verifies remote length',async t=>{
  const f=await fixture(t);let options,closed=0;let fail=false;
  const ftp={access:async o=>{options=o;},uploadFrom:async()=>{if(fail)throw new Error('offline');},size:async()=>123,pwd:async()=>'/',close:()=>closed++};
  const transport=new BambuTransport({...f,vault:fakeVault,ftpFactory:()=>ftp});t.after(()=>transport.close());
  assert.deepEqual(await transport.upload(f.printer,'source','target.gcode.3mf'),{bytes:123});assert.equal(options.secure,'implicit');assert.equal(options.port,990);assert.equal(closed,1);
  fail=true;await assert.rejects(transport.upload(f.printer,'source','target.gcode.3mf'));assert.equal(closed,2);
});
test('SQLite state survives closing and opening the database',async t=>{
  const f=await fixture(t);const reopened=new Store(f.dir);try{assert.equal(reopened.printer(f.printer.id).model,'P1S');assert.equal(reopened.transfer('transfer-1').status,'uploaded');}finally{reopened.close();}
});
test('Windows DPAPI round trip stores ciphertext rather than the access code',{skip:process.platform!=='win32'},async()=>{
  const vault=new WindowsVault(),value='hudson-fake-test-credential';const ciphertext=await vault.protect(value);
  assert.ok(!ciphertext.includes(value));assert.equal(await vault.unprotect(ciphertext),value);
});
