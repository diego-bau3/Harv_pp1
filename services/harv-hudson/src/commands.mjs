import { requireThat } from './errors.mjs';
const allowedBedTypes=new Set(['auto','textured_plate','hot_plate','eng_plate','cool_plate','supertack_plate']);
export function buildStart({printer,transfer,status,input,sequence,operationId,enforceFilamentChecks=true}) {
  const plate=transfer.archive.plates.find(p=>p.index===input.plate);
  requireThat(plate,'PLATE_NOT_FOUND','La placa seleccionada no existe.');
  requireThat(plate.model===printer.model,'WRONG_MODEL',`Archivo para ${plate.model || 'modelo desconocido'}; impresora ${printer.model}.`);
  requireThat(plate.nozzleDiameters.length===printer.nozzleDiameters.length && plate.nozzleDiameters.every((n,i)=>printer.nozzleDiameters[i]===n), 'WRONG_NOZZLE','Revisa los diámetros y el orden de las boquillas del archivo y la impresora.');
  requireThat(input.bedCleared===true && input.setupConfirmed===true,'SETUP_REQUIRED','Confirma cama despejada, placa, boquillas y materiales correctos.');
  requireThat(typeof input.useAms==='boolean','AMS_REQUIRED','Indica si el trabajo utiliza AMS.');
  const usedIds=plate.filaments.map(f=>f.id);
  requireThat(usedIds.length>0 && usedIds.every(x=>Number.isInteger(x)&&x>=1&&x<=64),'FILAMENT_METADATA','El archivo no contiene IDs de filamento suficientes para validar el envío.');
  let mapping=[],mapping2=[];
  if(input.filamentMapping) {
    requireThat(Array.isArray(input.filamentMapping)&&input.filamentMapping.length>=Math.max(...usedIds)&&input.filamentMapping.length<=64,'AMS_MAPPING','Se requiere una asignación por ID de filamento.');
    mapping2=input.filamentMapping.map(m=>{
      requireThat(m&&Number.isInteger(m.amsId)&&m.amsId>=0&&m.amsId<=255&&Number.isInteger(m.slotId)&&m.slotId>=0&&m.slotId<=3,'AMS_MAPPING','Asignación física inválida.');
      return {ams_id:m.amsId,slot_id:m.slotId};
    });
    mapping=mapping2.map(m=>m.ams_id>=254?-1:m.ams_id>=128?m.ams_id:m.ams_id*4+m.slot_id);
    requireThat(input.useAms===usedIds.some(id=>mapping2[id-1].ams_id<254),'AMS_MAPPING','useAms no coincide con las fuentes seleccionadas.');
    if(enforceFilamentChecks)for(const filament of plate.filaments) {
      const source=mapping2[filament.id-1];
      const slot=status.slots.find(s=>s.amsId===source.ams_id&&s.slotId===source.slot_id);
      requireThat(slot&&!slot.empty,'AMS_SLOT','La fuente asignada no aparece cargada en la telemetría.');
      requireThat(slot.material.toUpperCase()===filament.type.toUpperCase(),'MATERIAL_MISMATCH','El material cargado no coincide con el archivo.');
    }
  } else if(input.useAms) {
    requireThat(Array.isArray(input.amsMapping) && input.amsMapping.length>=Math.max(...usedIds) && input.amsMapping.length<=64,'AMS_MAPPING','Asigna los filamentos del archivo a ranuras AMS, en orden de ID (ID 1 = índice 0).');
    mapping=input.amsMapping;
    requireThat(mapping.every(x=>Number.isInteger(x)&&x>=-1&&x<=255),'AMS_MAPPING','Mapa AMS inválido.');
    for(const filament of plate.filaments) {
      const target=mapping[filament.id-1];
      const amsId=target>=128 ? target : Math.floor(target/4),slotId=target>=128 ? 0 : target%4;
      const slot=status.slots.find(s=>s.source==='ams'&&s.amsId===amsId&&s.slotId===slotId);
      requireThat(target>=0,'AMS_MAPPING','Indica una ranura AMS válida.');
      if(enforceFilamentChecks){
        requireThat(slot&&!slot.empty,'AMS_SLOT','La ranura asignada no aparece cargada en la telemetría.');
        requireThat(slot.material.toUpperCase()===filament.type.toUpperCase(),'MATERIAL_MISMATCH','El tipo de material cargado no coincide con el archivo.');
      }
    }
    mapping2=mapping.map(n=>n<0 ? {ams_id:255,slot_id:255} : {ams_id:n>=128?n:Math.floor(n/4),slot_id:n>=128?0:n%4});
  } else {
    requireThat(plate.filaments.length===1,'EXTERNAL_MULTIMATERIAL','La fase 1 requiere AMS para archivos con varios filamentos.');
    requireThat(printer.model!=='X2D','EXTERNAL_MAPPING','Indica filamentMapping para identificar el alimentador externo de X2D.');
  }
  const print={sequence_id:sequence,command:'project_file',param:plate.param,
    project_id:'0',profile_id:'0',task_id:'0',subtask_id:'0',
    subtask_name:`hudson-${operationId}`,file:transfer.remoteName,url:`ftp:///${transfer.remoteName}`,md5:'from_sd_card',
    bed_type:input.bedType || 'auto',bed_leveling:input.bedLeveling!==false,
    timelapse:input.timelapse===true,flow_cali:input.flowCalibration===true,vibration_cali:input.vibrationCalibration===true,
    layer_inspect:printer.model==='X1C',use_ams:input.useAms,ams_mapping:mapping,ams_mapping2:mapping2};
  requireThat(allowedBedTypes.has(print.bed_type),'BED_TYPE','Tipo de cama no admitido.');
  if(printer.model==='X2D') {
    requireThat(Array.isArray(input.nozzleMapping)&&input.nozzleMapping.length>=Math.max(...usedIds)&&input.nozzleMapping.every(n=>n===0||n===1),'NOZZLE_MAPPING','X2D requiere un mapa explícito de boquillas para los filamentos del archivo.');
    print.nozzle_mapping=input.nozzleMapping;
    print.nozzle_offset_cali=input.nozzleOffsetCalibration===true;
  }
  return {print};
}
