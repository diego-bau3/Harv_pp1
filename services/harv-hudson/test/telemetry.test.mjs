import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReport,normalizeTelemetry,hasTelemetry } from '../src/telemetry.mjs';
import { parseAnnouncement,isLanIp } from '../src/discovery.mjs';

test('partial reports preserve prior values and merge AMS by physical IDs, not array position',()=>{
  const old={gcode_state:'RUNNING',mc_percent:50,mc_remaining_time:60,ams:{ams:[{id:'2',tray:[{id:'3',tray_type:'PLA',tray_color:'00FF00FF',remain:40},{id:'0',tray_type:'PETG'}]}]}};
  const merged=mergeReport(old,{mc_percent:51,ams:{ams:[{id:'2',tray:[{id:'3',remain:39}]}]}});
  const status=normalizeTelemetry(merged);
  assert.equal(status.remainingMinutes,60);assert.equal(status.progress,51);assert.equal(status.slots[0].amsId,2);assert.equal(status.slots[0].slotId,3);
  assert.equal(status.slots[0].material,'PLA');assert.equal(status.slots[0].remainingPercent,39);assert.equal(status.slots.length,2);
});
test('zero updates and empty slots are respected, absent numbers remain unknown',()=>{
  const raw=mergeReport({mc_percent:40,mc_remaining_time:20,ams:{ams:[{id:'0',tray:[{id:'0',tray_type:'PLA',tray_color:'FFFFFFFF'}]}]}},{mc_percent:0,mc_remaining_time:0,ams:{ams:[{id:'0',tray:[{id:'0',tray_type:'',tray_color:''}]}]}});
  const status=normalizeTelemetry(raw);assert.equal(status.progress,0);assert.equal(status.remainingMinutes,0);assert.equal(status.slots[0].empty,true);
  assert.equal(normalizeTelemetry({}).progress,null);
});
test('FINISH is a collection state; acknowledgement is not telemetry',()=>{
  assert.equal(normalizeTelemetry({gcode_state:'FINISH'}).status,'finished');assert.equal(normalizeTelemetry({gcode_state:'FINISH'}).requiresCollection,true);
  assert.equal(hasTelemetry({command:'project_file',result:'success'}),false);
});
test('malformed optional AMS arrays do not crash normalization',()=>{
  assert.deepEqual(normalizeTelemetry({ams:{ams:'unexpected'},vir_slot:[null]}).slots,[]);
  assert.deepEqual(normalizeTelemetry({ams:{ams:[null,{tray:[null]}]}}).slots,[]);
  assert.equal(mergeReport([null],[{id:0,remain:0}])[0].remain,0);
});
test('untrusted report cannot change object prototypes',()=>{
  mergeReport({},JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'));
  assert.equal({}.polluted,undefined);
});
test('discovery requires Bambu identity and preserves supported model',()=>{
  assert.equal(parseAnnouncement('SERVER: something','192.168.1.1'),null);
  assert.equal(isLanIp('192.168.100.999'),false);assert.equal(isLanIp('8.8.8.8'),false);
  const p=parseAnnouncement('DevId.bambu.com: TESTSERIAL\r\nDevModel.bambu.com: N6\r\nDevName.bambu.com: X2D taller\r\n','192.168.1.4');
  assert.equal(p.model,'X2D');assert.equal(p.name,'X2D taller');
});
