import crypto from 'node:crypto';
import { requireThat } from './errors.mjs';
import { now } from './store.mjs';
import { labelRegistry,planSpoolLabels } from '../public/spool-labels.js';
import {filamentPositionBlock} from '../public/filament-access.js';

const roundMg=n=>Math.round(n*1000);
const grams=n=>n/1000;
const validWeight=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100000;
const color=s=>String(s||'').replace(/^#/,'').slice(0,6).toUpperCase();
const type=s=>String(s||'').trim().toUpperCase();
const running=s=>['preparing','printing','paused'].includes(s.status);
const percent=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;

export class InventoryService {
  constructor({store,production}) {
    Object.assign(this,{store,production});production.inventory=this;this.service=production.service;
    this.listener=(id,s)=>this.detectExternal(id,s);this.service.transport.on('telemetry',this.listener);
    // Legacy attempts deliberately keep no allocation; never charge today's roll for an old print.
    store.transaction(()=>{this.rememberLabels();this.replan();});
  }
  close(){this.service.transport.off('telemetry',this.listener);if(this.production.inventory===this)delete this.production.inventory;}
  receipt(scope,key,input){return this.production.receipt(`inventory:${scope}`,key,input);}
  spool(id){requireThat(typeof id==='string'&&id.length>0,'SPOOL_REQUIRED','Indica un ID de rollo.');const s=this.store.spool(id);requireThat(s,'NOT_FOUND','Rollo no encontrado.',404);return s;}
  policy(){return JSON.parse(this.store.getSetting('inventory-policy')||'{"reservePercent":10,"reserveGrams":2}');}
  enforceFilamentChecks(){return this.policy().enforceFilamentChecks!==false;}
  configure(input,key) {
    const r=this.receipt('policy',key,input);if(r.previous)return this.policy();
    requireThat(percent(input.reservePercent)&&validWeight(input.reserveGrams)&&input.reserveGrams<=100,'POLICY','Margen: 0–100% y 0–100 gramos por filamento.');
    requireThat(input.enforceFilamentChecks===undefined||typeof input.enforceFilamentChecks==='boolean','POLICY','La validación de filamento debe ser true o false.');
    const policy={reservePercent:input.reservePercent,reserveGrams:input.reserveGrams,
      enforceFilamentChecks:input.enforceFilamentChecks??this.enforceFilamentChecks()};
    this.store.transaction(()=>{this.store.setSetting('inventory-policy',JSON.stringify(policy));this.replan();r.save({ok:true});});return policy;
  }
  weight(input) {
    if(input.grossGrams!==undefined||input.tareGrams!==undefined) {
      requireThat(input.remainingGrams===undefined&&validWeight(input.grossGrams)&&validWeight(input.tareGrams)&&input.grossGrams>=input.tareGrams,'WEIGHT','Peso neto = peso total menos tara; no combines peso neto y total.');
      return roundMg(input.grossGrams)-roundMg(input.tareGrams);
    }
    requireThat(validWeight(input.remainingGrams),'WEIGHT','Indica los gramos restantes de filamento, sin el carrete.');return roundMg(input.remainingGrams);
  }
  labels() {return labelRegistry(JSON.parse(this.store.getSetting('spool-labels-v1')||'{}'),this.store.spools());}
  rememberLabels() {const registry=this.labels();this.store.setSetting('spool-labels-v1',JSON.stringify(registry));return registry;}
  createBatch(input,key) {
    // Allocate codes and record the complete batch/receipt under one write lock.
    // A lost response can be retried without making another set of rolls.
    return this.store.transaction(()=>{
      const r=this.receipt('create-batch',key,input);
      if(r.previous)return {spools:r.previous.ids.map(id=>this.view(id))};
      requireThat(Number.isInteger(input.quantity)&&input.quantity>=1&&input.quantity<=100,'QUANTITY','Indica entre 1 y 100 bobinas.');
      requireThat(typeof input.material==='string'&&/^[A-Za-z0-9 _+.-]{2,40}$/.test(input.material),'MATERIAL','Indica el tipo de material como aparece en el slicer.');
      requireThat(typeof input.brand==='string'&&input.brand.trim().length>0&&input.brand.trim().length<=80,'BRAND','Selecciona o escribe la marca.');
      requireThat(typeof input.color==='string'&&/^#[a-fA-F0-9]{6}$/.test(input.color),'COLOR','Selecciona un color para la bobina.');
      requireThat(['measured','estimated'].includes(input.basis),'BASIS','Indica measured (pesado) o estimated (estimado).');
      const amountMg=this.weight(input),low=input.lowGrams??100;
      requireThat(validWeight(low),'WEIGHT','Umbral de alerta inválido.');
      const plan=planSpoolLabels({labelRegistry:this.labels()},input),ids=[];
      for(const label of plan.labels) {
        const s={id:crypto.randomUUID(),...label,labelCode:label.name,brand:input.brand.trim(),material:type(input.material),color:input.color.toUpperCase(),
          lowGrams:low,basis:input.basis,archived:false,stockUncertain:false,createdAt:now()};
        const calibrationLedgerId=this.store.movement({spoolId:s.id,amountMg,kind:'opening',basis:s.basis,remainingGrams:grams(amountMg)});
        this.store.saveSpool({...s,calibrationLedgerId});ids.push(s.id);
      }
      this.store.setSetting('spool-labels-v1',JSON.stringify(plan.registry));r.save({ids});
      // New rolls are unmounted: no queue, reservation, or printer command changes.
      return {spools:ids.map(id=>this.view(id))};
    });
  }
  create(input,key) {
    const r=this.receipt('create',key,input);if(r.previous)return this.view(r.previous.id);
    requireThat(typeof input.name==='string'&&input.name.trim().length>0,'NAME','Pon un nombre o etiqueta al rollo.');
    requireThat(typeof input.material==='string'&&/^[A-Za-z0-9 _+.-]{2,40}$/.test(input.material),'MATERIAL','Indica el tipo de material como aparece en el slicer.');
    requireThat(!input.color||/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/.test(input.color),'COLOR','El color usa formato #RRGGBB o #RRGGBBAA.');
    requireThat(['measured','estimated'].includes(input.basis),'BASIS','Indica measured (pesado) o estimated (estimado).');
    const amountMg=this.weight(input),low=input.lowGrams??100;requireThat(validWeight(low),'WEIGHT','Umbral de alerta inválido.');
    const s={id:crypto.randomUUID(),name:input.name.trim().slice(0,120),brand:String(input.brand||'').slice(0,80),material:type(input.material),color:input.color||'',
      lowGrams:low,basis:input.basis,archived:false,stockUncertain:false,createdAt:now()};
    this.store.transaction(()=>{
      const id=this.store.movement({spoolId:s.id,amountMg,kind:'opening',basis:input.basis,remainingGrams:grams(amountMg)});
      this.store.saveSpool({...s,calibrationLedgerId:id});this.rememberLabels();this.replan();r.save({id:s.id});
    });return this.view(s.id);
  }
  activeForSpool(id) {return this.store.printers().map(p=>this.store.active(p.id)).filter(a=>a?.allocations?.some(l=>l.spoolId===id));}
  freeToChange(id) {
    requireThat(this.activeForSpool(id).length===0,'SPOOL_IN_USE','Ese rollo pertenece a un intento abierto. Detén y recolecta antes de cambiarlo o pesarlo.',409);
    const mount=this.store.mounts().find(m=>m.spoolId===id);
    requireThat(!mount||!running(this.service.transport.status(mount.printerId)),'SPOOL_IN_USE','La impresora sigue trabajando. Detén y retira el rollo antes de pesarlo.',409);
  }
  adjust(id,input,key) {
    const s=this.spool(id),r=this.receipt(`adjust:${id}`,key,input);if(r.previous)return this.view(id);
    this.freeToChange(id);requireThat(!s.archived,'ARCHIVED','El rollo está archivado.',409);
    requireThat(['measured','estimated'].includes(input.basis)&&typeof input.reason==='string'&&input.reason.trim().length>=5,'REVIEW_REQUIRED','Indica measured/estimated y el motivo del ajuste.');
    const target=this.weight(input);
    this.store.transaction(()=>{
      const ledgerId=this.store.movement({spoolId:id,amountMg:target-this.store.balanceMg(id),kind:'reconciliation',basis:input.basis,targetGrams:grams(target),reason:input.reason.slice(0,500)});
      this.store.saveSpool({...s,basis:input.basis,stockUncertain:false,uncertaintyReason:null,calibrationLedgerId:ledgerId,reconciledAt:now()});this.replan();r.save({id});
    });return this.view(id);
  }
  edit(id,input,key) {
    const s=this.spool(id),r=this.receipt(`edit:${id}`,key,input);if(r.previous)return this.view(id);
    requireThat(!s.labelCode||input.name===undefined||input.name===s.name,'LABEL_PERMANENT','El código de la bobina es permanente para conservar su etiqueta.');
    const low=input.lowGrams??s.lowGrams;requireThat(validWeight(low),'WEIGHT','Umbral de alerta inválido.');
    if(input.archived!==undefined)requireThat(typeof input.archived==='boolean','ARCHIVED','archived debe ser booleano.');
    if(input.archived){this.freeToChange(id);requireThat(!this.store.mounts().some(m=>m.spoolId===id),'MOUNTED','Retira el rollo de su ranura antes de archivarlo.',409);}
    this.store.transaction(()=>{this.rememberLabels();this.store.saveSpool({...s,name:String(input.name??s.name).slice(0,120),lowGrams:low,archived:input.archived??s.archived});this.rememberLabels();this.replan();r.save({id});});return this.view(id);
  }
  source(input) {
    requireThat(input&&['ams','external'].includes(input.source),'SOURCE','Indica source ams o external.');
    const amsId=input.amsId??(input.source==='external'?254:0),slotId=input.slotId??0;
    requireThat(Number.isInteger(amsId)&&Number.isInteger(slotId)&&slotId>=0&&slotId<=3&&
      (input.source==='external'?[254,255].includes(amsId)&&slotId===0:amsId>=0&&amsId<254),'SOURCE','IDs de alimentador o ranura inválidos.');
    return {source:input.source,amsId,slotId,sourceKey:`${input.source}:${amsId}:${slotId}`};
  }
  assignmentBlock(id,source) {
    return filamentPositionBlock({printer:this.service.printer(id),status:this.service.transport.status(id),active:this.store.active(id),source,
      busy:this.service.locks.has(id)||this.production.busy.has(id)||this.store.pending(id).length>0});
  }
  freeToAssign(spoolId) {
    const mount=this.store.mounts().find(m=>m.spoolId===spoolId),attempts=this.activeForSpool(spoolId);
    requireThat(!attempts.some(a=>!mount||a.printerId!==mount.printerId),'SPOOL_IN_USE','Asignada a una impresión abierta',409);
    if(mount){const reason=this.assignmentBlock(mount.printerId,mount);requireThat(!reason,'SPOOL_IN_USE',reason,409);}
  }
  recordAssignmentChange(printerId,source,fromSpoolId,toSpoolId) {
    if(fromSpoolId===toSpoolId)return;
    const a=this.store.active(printerId);
    if(!a||!a.allocations?.some(l=>l.sourceKey===source.sourceKey))return;
    // Keep the original allocation immutable. A changed multi-material path has
    // no reliable per-spool consumption split; use the existing review flow.
    this.store.saveAttempt({...a,materialRoutingUncertain:true,filamentChanges:[...(a.filamentChanges||[]),
      {sourceKey:source.sourceKey,fromSpoolId,toSpoolId,at:now()}]});
  }
  bind(id,input,key) {
    this.service.printer(id);const r=this.receipt(`mount:${id}`,key,input);if(r.previous)return {mounts:this.store.mounts().filter(m=>m.printerId===id)};
    const source=this.source(input),previous=this.store.mount(id,source.sourceKey);
    requireThat(input.confirmed===true,'SETUP_REQUIRED','Confirma que ese rollo está físicamente en la ranura indicada.');
    const block=this.assignmentBlock(id,source);requireThat(!block,'PRINTER_BUSY',block,409);
    if(previous)this.freeToAssign(previous.spoolId);
    let s,old;
    if(input.spoolId!==null) {
      s=this.spool(input.spoolId);this.freeToAssign(s.id);requireThat(!s.archived,'ARCHIVED','El rollo está archivado.',409);
      old=this.store.mounts().find(m=>m.spoolId===s.id);
    }
    this.store.transaction(()=>{
      if(old&&(old.printerId!==id||old.sourceKey!==source.sourceKey))this.recordAssignmentChange(old.printerId,old,s.id,null);
      this.recordAssignmentChange(id,source,previous?.spoolId||null,s?.id||null);
      if(previous)this.store.unmount(previous.spoolId);if(s)this.store.unmount(s.id);
      if(s) {
        const slot=this.service.transport.status(id).slots?.find(x=>x.amsId===source.amsId&&x.slotId===source.slotId);
        this.store.saveMount({...source,spoolId:s.id,printerId:id,confirmedAt:now(),observedTagUid:slot?.tagUid||null});
      }
      this.replan();r.save({ok:true});
    });return {mounts:this.store.mounts().filter(m=>m.printerId===id)};
  }
  filamentSource(settings,f) {
    const m=settings.filamentMapping?.[f.id-1];
    if(m)return this.source({source:m.amsId>=254?'external':'ams',...m});
    if(settings.useAms===false)return this.source({source:'external'});
    const n=settings.amsMapping?.[f.id-1];
    requireThat(Number.isInteger(n)&&n>=0&&n<254,'SOURCE','Falta asignar el filamento a una ranura.');
    return this.source({source:'ams',amsId:n>=128?n:Math.floor(n/4),slotId:n>=128?0:n%4});
  }
  normalizeChange(printerId,plate,settings,input) {
    if(input==null||input.enabled===false)return null;
    requireThat(input.enabled===true&&Array.isArray(input.filaments)&&input.filaments.length===plate.filaments.length,
      'FILAMENT_CHANGE','Selecciona una bobina del inventario para cada filamento.');
    requireThat(new Set(input.filaments.map(f=>f?.filamentId)).size===plate.filaments.length,'FILAMENT_CHANGE','No repitas IDs de filamento.');
    const bySource=new Map(),bySpool=new Map();
    const filaments=plate.filaments.map(f=>{
      const selected=input.filaments.find(v=>v?.filamentId===f.id),s=this.spool(selected?.spoolId),source=this.filamentSource(settings,f);
      requireThat(!s.archived&&(!this.enforceFilamentChecks()||!s.stockUncertain&&this.store.balanceMg(s.id)>0),'STOCK_REVIEW','Selecciona una bobina disponible con saldo confiable.');
      requireThat(!this.enforceFilamentChecks()||type(s.material)===type(f.type),'MATERIAL_MISMATCH','Puedes cambiar el color, pero el material debe coincidir con el archivo.');
      const mount=this.store.mounts().find(m=>m.spoolId===s.id);
      requireThat(!mount||(mount.printerId===printerId&&mount.sourceKey===source.sourceKey),'SPOOL_MOUNTED_ELSEWHERE','La bobina está colocada en otra ubicación. Selecciona su ubicación actual o una bobina del almacén.',409);
      requireThat(!bySource.has(source.sourceKey)||bySource.get(source.sourceKey)===s.id,'FILAMENT_CHANGE','Una posición no puede usar dos bobinas en la misma placa.');
      requireThat(!bySpool.has(s.id)||bySpool.get(s.id)===source.sourceKey,'FILAMENT_CHANGE','Una bobina no puede ocupar dos posiciones a la vez.');
      bySource.set(source.sourceKey,s.id);bySpool.set(s.id,source.sourceKey);
      return {filamentId:f.id,spoolId:s.id,name:s.name,material:s.material,color:s.color||null,originalColor:f.color||null,...source};
    });
    return {enabled:true,id:crypto.randomUUID(),filaments,createdAt:now()};
  }
  confirmChange(id,jobId,input,key) {
    const r=this.receipt(`planned-change:${jobId}`,key,input);if(r.previous)return r.previous;
    const job=this.production.job(jobId,id),head=this.store.jobs(id).find(j=>j.state==='queued'),status=this.service.transport.status(id);
    requireThat(job.state==='queued'&&head?.id===job.id,'QUEUE_CHANGED','Cambió la siguiente placa. Cierra y vuelve a revisar.',409);
    requireThat(job.materialChange?.enabled&&input.changeId===job.materialChange.id,'FILAMENT_CHANGE_CHANGED','Cambió el filamento programado. Cierra y vuelve a revisar.',409);
    requireThat(input.confirmed===true,'SETUP_REQUIRED','Confirma que colocaste y cargaste las bobinas indicadas.');
    requireThat(!this.store.active(id),'COLLECTION_REQUIRED','Primero confirma que retiraste la placa anterior.',409);
    requireThat(status.fresh&&['idle','finished','failed'].includes(status.status)&&!status.errors?.printError,'WRONG_STATE','Espera una impresora detenida, conectada y sin errores.',409);
    requireThat(!this.service.locks.has(id)&&!this.store.pending(id).length,'UNRESOLVED_COMMAND','Hay una operación pendiente. Espera su confirmación.',409);
    const plan=this.normalizeChange(id,this.production.item(job.libraryId).plates.find(p=>p.index===job.plate),job.settings,job.materialChange);
    const unique=[...new Map(plan.filaments.map(f=>[f.sourceKey,f])).values()];
    for(const f of unique) {
      this.freeToChange(f.spoolId);
      const previous=this.store.mount(id,f.sourceKey);if(previous)this.freeToChange(previous.spoolId);
      const slot=status.slots?.find(s=>s.amsId===f.amsId&&s.slotId===f.slotId);
      requireThat(!this.enforceFilamentChecks()||slot&&!slot.empty&&type(slot.material)===f.material,'SOURCE_NOT_LOADED','La impresora todavía no confirma el material en esa posición. Completa la carga antes de confirmar.',409);
    }
    return this.store.transaction(()=>{
      for(const f of unique) {
        const previous=this.store.mount(id,f.sourceKey);if(previous)this.store.unmount(previous.spoolId);
        const slot=status.slots.find(s=>s.amsId===f.amsId&&s.slotId===f.slotId);
        this.store.unmount(f.spoolId);
        this.store.saveMount({...this.source(f),spoolId:f.spoolId,printerId:id,confirmedAt:now(),observedTagUid:slot?.tagUid||null});
      }
      this.replan();const result={jobId,changeId:job.materialChange.id,confirmed:true};
      this.store.event(id,'planned-filament-confirmed',result);r.save(result);return result;
    });
  }
  requirements(job) {
    const plate=this.store.libraryItem(job.libraryId)?.plates.find(p=>p.index===job.plate),issues=[],lines=[],policy=this.policy();
    if(!this.enforceFilamentChecks()) {
      // Planning is unrestricted. Debit only the physically assigned, identified
      // spool, never a future planned replacement or a fabricated inventory roll.
      for(const f of plate?.filaments||[]) {
        if(!Number.isInteger(f.id)||f.id<1||f.id>64||!validWeight(f.grams))continue;
        let source;try{source=this.filamentSource(job.settings,f);}catch{continue;}
        const mount=this.store.mount(job.printerId,source.sourceKey),s=mount&&this.store.spool(mount.spoolId);
        if(!s||s.archived)continue;
        const status=this.service.transport.status(job.printerId),slot=status?.slots?.find(v=>v.amsId===source.amsId&&v.slotId===source.slotId);
        if(status?.fresh&&mount.observedTagUid&&slot?.tagUid&&mount.observedTagUid!==slot.tagUid)continue;
        const plannedMg=roundMg(f.grams),reserveMg=plannedMg===0?0:Math.ceil(plannedMg*(1+policy.reservePercent/100))+roundMg(policy.reserveGrams);
        lines.push({filamentId:f.id,spoolId:s.id,material:s.material,plannedMg,reserveMg,...source,observedTagUid:mount.observedTagUid||null});
      }
      return {lines,issues};
    }
    if(!plate?.filaments?.length)return {lines,issues:[{code:'FILAMENT_METADATA',message:'No hay metadatos de filamento.'}]};
    for(const f of plate.filaments) {
      if(!Number.isInteger(f.id)||f.id<1||f.id>64||!validWeight(f.grams)){issues.push({code:'UNKNOWN_GRAMS',filamentId:f.id,message:'El slicer no indica gramos válidos.'});continue;}
      let source=null,loaded=null;
      const planned=job.materialChange?.filaments.find(p=>p.filamentId===f.id);
      const expected={material:f.type,color:planned?planned.color:f.color||null};
      try {
        source=this.filamentSource(job.settings,f);
        const mount=this.store.mount(job.printerId,source.sourceKey);
        const actual=mount&&this.store.spool(mount.spoolId);
        loaded=actual?{spoolId:actual.id,name:actual.name,material:actual.material,color:actual.color||null}:null;
        requireThat(planned||mount,'SPOOL_REQUIRED','Registra qué rollo está cargado en esta ranura.');
        const s=this.spool(planned?.spoolId||mount.spoolId);
        requireThat(!planned||planned.sourceKey===source.sourceKey,'FILAMENT_CHANGE','Cambió la posición del filamento programado. Edita el trabajo.');
        requireThat(!s.archived&&!s.stockUncertain,'STOCK_REVIEW','Revisa o reconcilia el inventario del rollo.');
        requireThat(s.material===type(f.type),'MATERIAL_MISMATCH','El material del rollo no coincide con el archivo.');
        requireThat(!s.color||!expected.color||color(s.color)===color(expected.color),'COLOR_MISMATCH','El color del rollo no coincide con el trabajo.');
        const plannedMg=roundMg(f.grams),reserveMg=plannedMg===0?0:Math.ceil(plannedMg*(1+policy.reservePercent/100))+roundMg(policy.reserveGrams);
        lines.push({filamentId:f.id,spoolId:s.id,material:s.material,plannedMg,reserveMg,...source,observedTagUid:mount?.spoolId===s.id?mount.observedTagUid:null});
        if(planned&&mount?.spoolId!==s.id)issues.push({code:'FILAMENT_CHANGE_REQUIRED',filamentId:f.id,expected,source,loaded,
          target:{spoolId:s.id,name:s.name,material:s.material,color:s.color||null},message:`Cambia a ${s.name} y confirma la bobina cargada en IPAD.`});
      } catch(error) {issues.push({code:error.code||'MAPPING',filamentId:f.id,plannedGrams:f.grams,material:f.type,color:f.color,
        expected,loaded,source,message:error.message});}
    }
    if(new Set(plate.filaments.map(f=>f.id)).size!==plate.filaments.length)issues.push({code:'FILAMENT_METADATA',message:'IDs de filamento duplicados.'});
    return {lines,issues};
  }
  plan(job,status=this.service.transport.status(job.printerId)) {
    const saved=this.store.materialPlan(job.id);
    if(!saved)return null;
    if(!this.enforceFilamentChecks())return {...saved,issues:[],warnings:[],enforceFilamentChecks:false,state:saved.state==='active'?'active':'ready'};
    const issues=[...saved.issues],warnings=[];
    const add=issue=>{if(!issues.some(i=>i.code===issue.code&&i.filamentId===issue.filamentId))issues.push(issue);};
    const plate=this.store.libraryItem(job.libraryId)?.plates.find(p=>p.index===job.plate);
    // Read current slot reports without rewriting reservations on every poll.
    if(status?.fresh)for(const f of plate?.filaments||[]) {
      let source;try{source=this.filamentSource(job.settings,f);}catch{continue;}
      const mount=this.store.mount(job.printerId,source.sourceKey),s=mount&&this.store.spool(mount.spoolId);
      const slot=status.slots?.find(slot=>slot.amsId===source.amsId&&slot.slotId===source.slotId);
      const planned=job.materialChange?.filaments.find(p=>p.filamentId===f.id);
      const context={filamentId:f.id,expected:{material:f.type,color:planned?planned.color:f.color||null},source,
        loaded:s?{spoolId:s.id,name:s.name,material:s.material,color:s.color||null}:null,
        reported:slot?{material:slot.material,color:slot.color||null}:null};
      if(planned&&mount?.spoolId!==planned.spoolId)continue;
      if(!slot||slot.empty)add({...context,code:'SOURCE_NOT_LOADED',message:'La impresora no reporta material en la ubicación seleccionada.'});
      else if(type(slot.material)!==type(f.type))add({...context,code:'PRINTER_MATERIAL_MISMATCH',message:'El material configurado en la impresora no coincide con el archivo.'});
      if(mount?.observedTagUid&&slot?.tagUid&&mount.observedTagUid!==slot.tagUid)add({...context,code:'ROLL_CHANGED',message:'El AMS reporta otra etiqueta de rollo. Confirma el rollo cargado.'});
      // Reported colors can be manually configured. A discrepancy is an alert,
      // not evidence that the operator-confirmed physical spool changed color.
      const reportedColor=String(slot?.color||'').replace(/^#/,'');
      if(s?.color&&slot&&!slot.empty&&/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(reportedColor)&&
        !(reportedColor.length===8&&reportedColor.slice(6)==='00')&&color(s.color)!==color(reportedColor))
        warnings.push({...context,code:'PRINTER_COLOR_CONFLICT',message:'La configuración de color de la impresora difiere del rollo registrado en Hudson.'});
    }
    return {...saved,issues,warnings,state:saved.state==='active'?'active':issues.length?'blocked':'ready'};
  }
  replan() {
    this.store.clearReservations();const budget=new Map(this.store.spools().map(s=>[s.id,this.store.balanceMg(s.id)]));
    const printers=this.store.printers();
    // In-flight reservations are immutable snapshots, independent of current queue settings.
    for(const p of printers) {
      const a=this.store.active(p.id);if(!a)continue;
      const settled=this.store.usage(a.id)?.status==='settled',lines=a.allocations||[];
      for(const l of lines)if(!settled){this.store.reserve(a.jobId,l.spoolId,l.reserveMg);budget.set(l.spoolId,budget.get(l.spoolId)-l.reserveMg);}
      this.store.saveMaterialPlan({jobId:a.jobId,printerId:p.id,state:'active',attemptId:a.id,lines,issues:a.materialRoutingUncertain?[{code:'ROLL_CHANGED',message:'Cambió la etiqueta del rollo durante el intento; concilia su consumo.'}]:lines.length?[]:[{code:'LEGACY_UNTRACKED',message:'Intento anterior al inventario; requiere conciliación del rollo.'}]});
    }
    for(const p of printers)for(const j of this.store.jobs(p.id).filter(j=>j.state==='queued')) {
      const {lines,issues}=this.requirements(j);
      for(const l of lines) {
        const available=budget.get(l.spoolId)||0;
        if(this.enforceFilamentChecks()&&available<l.reserveMg)issues.push({code:'INSUFFICIENT_FILAMENT',spoolId:l.spoolId,missingGrams:grams(l.reserveMg-Math.max(0,available)),message:'La cola supera el filamento disponible con margen.'});
        budget.set(l.spoolId,available-l.reserveMg);this.store.reserve(j.id,l.spoolId,l.reserveMg);
      }
      this.store.saveMaterialPlan({jobId:j.id,printerId:p.id,state:issues.length?'blocked':'ready',lines,issues});
    }
  }
  prepare(job,status) {
    this.replan();const plan=this.store.materialPlan(job.id);
    if(!this.enforceFilamentChecks())return structuredClone(plan?.lines||[]);
    requireThat(plan?.state==='ready','MATERIAL_BLOCKED',plan?.issues?.[0]?.message||'El plan de filamento está bloqueado. Revisa los rollos asignados.',409);
    for(const l of plan.lines) {
      const slot=status.slots?.find(s=>s.amsId===l.amsId&&s.slotId===l.slotId);
      requireThat(!l.observedTagUid||!slot?.tagUid||slot.tagUid===l.observedTagUid,'ROLL_CHANGED','El AMS reporta otra etiqueta RFID. Confirma el rollo cargado.',409);
    }
    return structuredClone(plan.lines);
  }
  track(a,s) {
    if(percent(s.progress))a.materialProgress={percent:Math.max(a.materialProgress?.percent??0,s.progress),at:now(),method:'maximum-observed-progress'};
    for(const l of a.allocations||[]) {
      const slot=s.slots?.find(s=>s.amsId===l.amsId&&s.slotId===l.slotId);
      if(l.observedTagUid&&slot?.tagUid&&l.observedTagUid!==slot.tagUid)a.materialRoutingUncertain=true;
    }
  }
  checkActive(a,status) {
    if(!this.enforceFilamentChecks())return;
    const totals=new Map();
    for(const l of a.allocations) {
      const s=this.spool(l.spoolId),mount=this.store.mount(a.printerId,l.sourceKey);
      requireThat(mount?.spoolId===l.spoolId&&!s.archived&&!s.stockUncertain,'STOCK_REVIEW','Cambió la asignación o confiabilidad del rollo; revisa el inventario.',409);
      const slot=status.slots?.find(s=>s.amsId===l.amsId&&s.slotId===l.slotId);
      requireThat(!l.observedTagUid||!slot?.tagUid||l.observedTagUid===slot.tagUid,'ROLL_CHANGED','Cambió la etiqueta RFID del rollo.',409);
      totals.set(s.id,(totals.get(s.id)||0)+l.reserveMg);
    }
    for(const [id,mg] of totals)requireThat(this.store.balanceMg(id)>=mg,'INSUFFICIENT_FILAMENT','El rollo ya no alcanza para esta placa y su margen.',409);
  }
  estimate(a,outcome,input={}) {
    const allocations=a.allocations||[];
    if(!allocations.length)return {status:'untracked',method:'legacy-untracked',lines:[],message:'Sin rollos capturados al inicio; no se descontó inventario retroactivamente.'};
    if(input.gramsByFilament!==undefined) {
      requireThat(['measured','estimated'].includes(input.basis),'BASIS','Indica measured o estimated para el consumo corregido.');
      requireThat(typeof input.reason==='string'&&input.reason.trim().length>=5,'REASON','Explica el consumo corregido.');
      const amounts=input.gramsByFilament;
      requireThat(Array.isArray(amounts)&&amounts.length===allocations.length&&new Set(amounts.map(x=>x?.filamentId)).size===allocations.length&&allocations.every(l=>amounts.some(x=>x?.filamentId===l.filamentId&&validWeight(x.grams))),'USAGE','Indica gramos por cada ID de filamento, incluyendo ceros.');
      return {status:'settled',method:input.basis==='measured'?'measured':'manual-estimate',reason:input.reason.slice(0,500),lines:allocations.map(l=>({...l,usedMg:roundMg(amounts.find(x=>x.filamentId===l.filamentId).grams)}))};
    }
    if(a.materialRoutingUncertain)return {status:'needs_review',method:'roll-changed',lines:allocations,message:'Cambió la etiqueta del rollo; indica gramos consumidos de los rollos originales y reconcilia los demás rollos usados.'};
    let fraction,method;
    if(input.progressPercent!==undefined) {
      requireThat(percent(input.progressPercent)&&typeof input.reason==='string'&&input.reason.trim().length>=5,'USAGE','Progreso manual: 0–100 y un motivo.');
      fraction=input.progressPercent/100;method='manual-progress';
    } else if(a.notStartedConfirmedAt&&outcome==='aborted') {fraction=0;method='no-start';}
    else if(outcome==='finished'||a.terminalTelemetry?.status==='finished') {fraction=1;method='slicer-total';}
    else if(a.materialProgress&&percent(a.materialProgress.percent)){fraction=a.materialProgress.percent/100;method='progress-estimate';}
    else if(!this.store.request(a.printerId,a.startKey)||this.store.request(a.printerId,a.startKey)?.status==='rejected'){fraction=0;method='no-start';}
    else return {status:'needs_review',method:'unknown-progress',lines:allocations,message:'Falta progreso fiable; indica consumo por filamento o porcentaje observado.'};
    return {status:'settled',method,progressPercent:fraction*100,reason:input.reason?.slice(0,500),lines:allocations.map(l=>({...l,usedMg:Math.round(l.plannedMg*fraction)}))};
  }
  // Called inside the same SQLite transaction as the terminal state / collection.
  finish(a,outcome,input) {
    const previous=this.store.usage(a.id);
    if(previous?.status==='settled'&&!input)return previous;
    let estimate=this.estimate(a,outcome,input||{});
    if(estimate.status==='needs_review'&&!this.enforceFilamentChecks()) {
      estimate={...estimate,status:'untracked',message:'Consumo pendiente de conciliar; no impide continuar la cola.'};
      for(const l of a.allocations||[]){const s=this.spool(l.spoolId);this.store.saveSpool({...s,stockUncertain:true,uncertaintyReason:'Consumo sin contabilizar; revisa los gramos restantes cuando puedas.'});}
    }
    if(a.untrackedFilamentIds?.length)estimate={...estimate,untrackedFilamentIds:a.untrackedFilamentIds,trackingIncomplete:true};
    const usage={...estimate,attemptId:a.id,jobId:a.jobId,printerId:a.printerId,outcome,revision:(previous?.revision||0)+1,updatedAt:now()};
    if(a.materialRoutingUncertain)for(const spoolId of new Set([...(a.allocations||[]).map(l=>l.spoolId),...(a.filamentChanges||[]).flatMap(c=>[c.fromSpoolId,c.toSpoolId]).filter(Boolean)])) {
      const s=this.spool(spoolId);this.store.saveSpool({...s,stockUncertain:true,uncertaintyReason:'Cambió una bobina usada por la placa; revisa su consumo.'});
    }
    if(usage.status==='settled')for(const line of usage.lines) {
      const old=previous?.status==='settled'?previous.lines.find(l=>l.filamentId===line.filamentId):null;
      const spool=this.spool(line.spoolId),amountMg=(old?.usedMg||0)-line.usedMg;
      // A later absolute weighing already supersedes historical estimates.
      const affectsStock=!old||old.anchorLedgerId>spool.calibrationLedgerId;
      const ledgerId=this.store.movement({spoolId:line.spoolId,amountMg:affectsStock?amountMg:0,kind:old?'usage-correction':'consumption',attemptId:a.id,
        filamentId:line.filamentId,method:usage.method,revision:usage.revision,affectsStock,usageDeltaMg:amountMg,reason:usage.reason});
      line.anchorLedgerId=old?.anchorLedgerId||ledgerId;line.grams=grams(line.usedMg);
    }
    usage.totalGrams=usage.status==='settled'?grams(usage.lines.reduce((n,l)=>n+l.usedMg,0)):null;
    this.store.saveUsage(usage);return usage;
  }
  correct(id,attemptId,input,key) {
    const a=this.store.attempt(attemptId);requireThat(a?.printerId===id,'NOT_FOUND','Intento no encontrado.',404);
    requireThat(a.allocations?.length,'LEGACY_UNTRACKED','Ese intento no capturó rollos; reconcilia el peso actual sin atribuirle rollos retroactivamente.',409);
    const r=this.receipt(`usage:${attemptId}`,key,input);if(r.previous)return this.store.usage(attemptId);
    requireThat(['awaiting_collection','collected'].includes(a.state),'WRONG_STATE','Espera el final del intento para corregir su consumo.',409);
    requireThat(input.gramsByFilament!==undefined||input.progressPercent!==undefined,'USAGE','Indica consumo por filamento o progreso observado.');
    this.store.transaction(()=>{
      const usage=this.finish(a,a.outcome||this.store.collection(attemptId)?.outcome,input);
      requireThat(usage.status==='settled','USAGE_REVIEW',usage.message||'Falta conciliar el consumo.',409);
      this.replan();r.save({id:attemptId});
    });return this.store.usage(attemptId);
  }
  view(id) {
    const s=this.spool(id),balance=this.store.balanceMg(id),reserved=this.store.reservedMg(id),alerts=[];
    if(!s.archived) {
      if(balance<0)alerts.push('NEGATIVE_BALANCE');
      if(balance<=roundMg(s.lowGrams))alerts.push('LOW_STOCK');
      if(balance-reserved<0)alerts.push('QUEUE_SHORTAGE');
      else if(reserved>0&&balance-reserved<=roundMg(s.lowGrams))alerts.push('LOW_AFTER_QUEUE');
      if(s.stockUncertain)alerts.push('STOCK_REVIEW');
    }
    return {...s,remainingGrams:grams(balance),reservedGrams:grams(reserved),availableGrams:grams(balance-reserved),alerts,
      mount:this.store.mounts().find(m=>m.spoolId===id)||null,balanceIsEstimate:s.basis==='estimated'||this.store.hasEstimatedUsage(id,s.calibrationLedgerId)};
  }
  overview() {
    const spools=this.store.spools().map(s=>this.view(s.id)),plans=this.store.materialPlans();
    return {spools,labelRegistry:this.labels(),policy:this.policy(),plans,alerts:[...spools.flatMap(s=>s.alerts.map(code=>({code,spoolId:s.id,name:s.name}))),
      ...plans.filter(p=>p.issues.length).map(p=>({code:'JOB_MATERIAL_BLOCKED',jobId:p.jobId,printerId:p.printerId,issues:p.issues}))],
      pendingUsage:this.store.pendingUsages(),notificationDelivery:'api-only'};
  }
  detectExternal(id,s) {
    if(!s.fresh||!running(s)||(!s.currentJob?.name&&!s.currentJob?.file))return;
    const a=this.store.active(id);if(a&&this.production.matches(a,s))return;
    const affected=this.store.mounts().filter(m=>m.printerId===id).map(m=>this.spool(m.spoolId)).filter(s=>!s.stockUncertain);
    if(!affected.length)return;
    this.store.transaction(()=>{for(const spool of affected)this.store.saveSpool({...spool,stockUncertain:true,uncertaintyReason:'Impresión fuera del intento de Hudson; consumo sin contabilizar.'});this.replan();});
  }
}
