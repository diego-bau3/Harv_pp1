// Shared by the inventory API and PC/iPad. No commands or inventory writes.
export const filamentSourceKey=s=>`${s.source}:${s.amsId}:${s.slotId}`;
export const filamentRunning=s=>['preparing','printing','paused'].includes(s?.status);
const integer=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isInteger(Number(v))?Number(v):null;
function packed(value){
  const n=integer(value);if(n===null||n<0||n>65535)return undefined;
  if(n===65535)return null;
  const amsId=n>>>8,slotId=n&255;
  if(slotId>3||amsId>=254&&slotId!==0)return undefined;
  return filamentSourceKey({source:amsId>=254?'external':'ams',amsId,slotId});
}
function legacy(value){
  const n=integer(value);if(n===null||n<0||n>255)return undefined;
  if(n===255)return null; // no filament; 254 is external on single-extruder reports
  if(n===254)return 'external:254:0';
  if(n>=128&&n<=135)return `ams:${n}:0`;
  if(n>=128)return undefined;
  return `ams:${Math.floor(n/4)}:${n%4}`;
}
export function reportedFilamentUse(raw={}){
  const extruders=raw.device?.extruder??raw.extruder;
  if(extruders!==undefined&&extruders!==null){
    const state=integer(extruders.state),count=state===null?0:state&15,info=extruders.info;
    const complete=count>0&&count<=2&&Array.isArray(info)&&info.length===count&&
      new Set(info.map(e=>integer(e?.id))).size===count&&info.every(e=>integer(e?.id)!==null&&+e.id>=0&&+e.id<count);
    const current=complete?info.map(e=>packed(e.snow)):[],target=complete?info.map(e=>packed(e.star)):[];
    return {mode:'extruder',count,known:!!complete&&current.every(v=>v!==undefined)&&target.every(v=>v!==undefined),
      current:[...new Set(current.filter(v=>typeof v==='string'))],target:[...new Set(target.filter(v=>typeof v==='string'))]};
  }
  const current=legacy(raw.ams?.tray_now),target=legacy(raw.ams?.tray_tar);
  return {mode:'legacy',count:1,known:current!==undefined&&target!==undefined,current:current?[current]:[],target:target?[target]:[]};
}
// Only complete routing reports renew the safety clock, not temperature/progress deltas.
export function hasCompleteFilamentReport(raw,mode){
  return mode==='extruder'?reportedFilamentUse(raw).mode==='extruder'&&reportedFilamentUse(raw).known:
    Object.hasOwn(raw.ams||{},'tray_now')&&Object.hasOwn(raw.ams||{},'tray_tar');
}
export function filamentPositionBlock({printer,status=printer?.telemetry,active,source,connected=true,busy=false}={}){
  if(!connected||!status?.fresh||!printer||printer.unlinked)return 'Espera a que vuelva la conexión para registrar un cambio.';
  if(busy)return 'Hay una operación pendiente. Espera su confirmación.';
  if(filamentRunning(status)){
    if(source&&source.source!=='ams')return 'El rollo externo no se cambia mientras la impresora trabaja.';
    const use=status.filamentUse;
    if(!use?.known||status.filamentUseFresh!==true||(printer.model==='X2D'&&(use.mode!=='extruder'||use.count!==2)))
      return 'Espera la lectura del AMS para identificar la bobina en uso.';
    if(active&& !['printing','preparing','paused'].includes(active.state))return 'Primero revisa el intento abierto de esta impresora.';
    if(source){
      const key=filamentSourceKey(source);
      if(use.current.includes(key))return 'En uso: esta bobina está alimentando la impresora.';
      if(use.target.includes(key))return 'En uso: la impresora está cargando esta posición.';
      const known=status.slots?.some(s=>s.source==='ams'&&s.amsId===source.amsId&&(s.slotId===source.slotId||source.amsId<128));
      if(!known)return 'La impresora no confirma esta posición del AMS.';
    }
    return '';
  }
  if(active||!['idle','finished','failed'].includes(status.status))return 'Podrás cambiar la bobina al terminar y confirmar la placa retirada.';
  return '';
}
