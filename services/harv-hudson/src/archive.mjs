import yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireThat,HudsonError } from './errors.mjs';

export function canonicalModel(value) {
  const clean=String(value || '').replace(/^Bambu Lab\s+/i,'').replace(/\s+\d\.\d.*$/,'').trim().toUpperCase();
  return ({'X1 CARBON':'X1C','X1-CARBON':'X1C','BL-P001':'X1C','C12':'P1S','N2S':'A1','N6':'X2D'})[clean] || clean;
}
export async function sha256(file) {
  const hash=createHash('sha256');for await (const chunk of createReadStream(file)) hash.update(chunk);return hash.digest('hex');
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export async function inspectArchive(file) {
  const files=[],contents={};
  await new Promise((resolve,reject)=>{
    yauzl.open(file,{lazyEntries:true,autoClose:true},(error,zip)=>{
      if(error) return reject(new HudsonError('INVALID_3MF','El archivo no es un 3MF ZIP válido.'));
      let settled=false,count=0;
      const fail=err=>{if(settled)return;settled=true;zip.close();reject(err);};
      zip.on('error',()=>fail(new HudsonError('INVALID_3MF','No se pudo leer el 3MF.')));
      zip.on('end',()=>{if(!settled){settled=true;resolve();}});
      zip.on('entry',entry=>{
        if(++count>20000) return fail(new HudsonError('INVALID_3MF','Demasiadas entradas en el archivo.'));
        if(entry.generalPurposeBitFlag & 1) return fail(new HudsonError('INVALID_3MF','No se aceptan archivos cifrados.'));
        if(/^Metadata\/plate_\d+\.gcode$/.test(entry.fileName) && entry.uncompressedSize>0) files.push(entry.fileName);
        if(!['Metadata/project_settings.config','Metadata/slice_info.config'].includes(entry.fileName)){zip.readEntry();return;}
        if(contents[entry.fileName]!==undefined) return fail(new HudsonError('INVALID_3MF','Metadatos duplicados.'));
        if(entry.uncompressedSize>4*1024*1024) return fail(new HudsonError('INVALID_3MF','Metadatos demasiado grandes.'));
        zip.openReadStream(entry,(err,stream)=>{
          if(err)return fail(new HudsonError('INVALID_3MF','Metadatos ilegibles.'));
          const chunks=[];let size=0;
          stream.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){stream.destroy();fail(new HudsonError('INVALID_3MF','Metadatos demasiado grandes.'));}else chunks.push(chunk);});
          stream.on('error',()=>fail(new HudsonError('INVALID_3MF','Metadatos ilegibles.')));
          stream.on('end',()=>{if(settled)return;contents[entry.fileName]=Buffer.concat(chunks).toString('utf8');zip.readEntry();});
        });
      });
      zip.readEntry();
    });
  });
  requireThat(files.length>0,'UNSLICED','El 3MF no contiene placas sliceadas. Exporta el archivo sliceado desde Bambu Studio.');
  requireThat(new Set(files).size===files.length,'INVALID_3MF','Hay placas duplicadas en el archivo.');
  let project={},slice={};
  try {
    if(contents['Metadata/project_settings.config']) project=JSON.parse(contents['Metadata/project_settings.config']);
    const xml=contents['Metadata/slice_info.config'] || '';
    requireThat(!/<!DOCTYPE|<!ENTITY/i.test(xml),'INVALID_3MF','Declaraciones XML no admitidas.');
    if(xml) slice=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:false}).parse(xml);
  } catch { throw new HudsonError('INVALID_3MF','Los metadatos del archivo no son válidos.'); }
  const plates=files.map(param=>{
    const index=Number(param.match(/plate_(\d+)/)[1]);
    const plate=array(slice.config?.plate).find(p=>array(p.metadata).some(m=>m.key==='index'&&Number(m.value)===index));
    const meta=Object.fromEntries(array(plate?.metadata).map(m=>[m.key,m.value]));
    const model=canonicalModel(meta.printer_model_id || project.printer_model || project.printer_settings_id);
    const nozzles=project.nozzle_diameter ? array(project.nozzle_diameter).map(Number) : meta.nozzle_diameters ? String(meta.nozzle_diameters).split(/[,;]/).map(Number) : [];
    return {index,param,model,nozzleDiameters:nozzles.filter(n=>n>0),
      filaments:array(plate?.filament).map(f=>({id:Number(f.id),type:f.type || '',color:f.color || '',grams:f.used_g!==undefined&&f.used_g!==''&&Number.isFinite(Number(f.used_g))&&Number(f.used_g)>=0?Number(f.used_g):null})),
      predictedSeconds:Number(meta.prediction)>0?Number(meta.prediction):null,
      objectCount:array(plate?.object).length || null,
      // A dual-nozzle start always needs an explicit operator-reviewed nozzle mapping.
      bedType:project.curr_bed_type || null};
  });
  return {sha256:await sha256(file),plates};
}
