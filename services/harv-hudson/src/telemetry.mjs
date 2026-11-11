import {reportedFilamentUse} from '../public/filament-access.js';
const forbidden = new Set(['__proto__','prototype','constructor']);
export function mergeReport(old,patch) {
  if (Array.isArray(patch)) {
    if (!patch.length) return [];
    if (patch.every(x => x && typeof x === 'object' && x.id !== undefined)) {
      const byId = new Map((Array.isArray(old) ? old : []).filter(x=>x&&typeof x==='object'&&x.id!==undefined).map(x => [String(x.id),x]));
      for (const item of patch) byId.set(String(item.id),mergeReport(byId.get(String(item.id)),item));
      return [...byId.values()];
    }
    return structuredClone(patch);
  }
  if (patch && typeof patch === 'object') {
    const result = old && typeof old === 'object' && !Array.isArray(old) ? {...old} : {};
    for (const [key,value] of Object.entries(patch)) if (!forbidden.has(key)) result[key] = mergeReport(result[key],value);
    return result;
  }
  return patch;
}
const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const states = { IDLE:'idle', READY:'idle', RUNNING:'printing', PRINTING:'printing', PREPARE:'preparing', PREPARING:'preparing', SLICING:'preparing', PAUSE:'paused', PAUSED:'paused', FINISH:'finished', FINISHED:'finished', COMPLETED:'finished', FAILED:'failed', FAIL:'failed', ERROR:'failed', ABNORMAL:'failed' };
export function normalizeTelemetry(raw = {}) {
  const slots = [];
  for (const ams of Array.isArray(raw.ams?.ams) ? raw.ams.ams : []) {
    for (const tray of Array.isArray(ams?.tray) ? ams.tray : []) {
      if (ams?.id === undefined || tray?.id === undefined) continue;
      const amsId = Number(ams.id), slotId = Number(tray.id);
      slots.push({ id:`ams:${amsId}:${slotId}`,amsId,slotId, source:'ams',
        material:String(tray.tray_type ?? ''),color:String(tray.tray_color ?? ''),
        remainingPercent:num(tray.remain) >= 0 ? num(tray.remain) : null,
        tagUid:tray.tag_uid || '',filamentId:tray.tray_info_idx || '',
        empty: !tray.tray_type && !tray.tray_color });
    }
  }
  const external = raw.vir_slot || (Array.isArray(raw.vt_tray) ? raw.vt_tray : raw.vt_tray ? [raw.vt_tray] : []);
  for (const tray of Array.isArray(external) ? external : []) {
    if(!tray||typeof tray!=='object')continue;
    const id = num(tray.id) ?? 254;
    slots.push({id:`external:${id}`,source:'external',amsId:id,slotId:0,material:String(tray.tray_type ?? ''),color:String(tray.tray_color ?? ''),remainingPercent:null,empty:!tray.tray_type});
  }
  return {
    status:states[String(raw.gcode_state || '').toUpperCase()] || 'unknown',
    rawState:raw.gcode_state || '',progress:num(raw.mc_percent),remainingMinutes:num(raw.mc_remaining_time),
    layer:num(raw.layer_num),totalLayers:num(raw.total_layer_num),
    currentJob:{name:String(raw.subtask_name || ''),file:String(raw.gcode_file || ''),taskId:raw.task_id ?? '',subtaskId:raw.subtask_id ?? ''},
    temperatures:{nozzle:num(raw.nozzle_temper),bed:num(raw.bed_temper),chamber:num(raw.chamber_temper)},
    activeTray:raw.ams?.tray_now ?? null,filamentUse:reportedFilamentUse(raw),slots,errors:{printError:num(raw.print_error),hms:raw.hms || []},
    // Keep model-specific structure available to phase 2 without guessing nozzle IDs.
    extruders:raw.device?.extruder ?? raw.extruder ?? null,
    requiresCollection:['FINISH','FINISHED','COMPLETED','FAILED','FAIL','ERROR'].includes(raw.gcode_state)
  };
}
export function hasTelemetry(print) {
  return print && ['gcode_state','mc_percent','mc_remaining_time','nozzle_temper','layer_num','ams','device','vt_tray','vir_slot'].some(k=>Object.hasOwn(print,k));
}
