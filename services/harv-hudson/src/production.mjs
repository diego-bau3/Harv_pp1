import crypto from 'node:crypto';
import path from 'node:path';
import { copyFile,mkdir,rename,stat,unlink } from 'node:fs/promises';
import { inspectArchive,sha256 } from './archive.mjs';
import { buildStart } from './commands.mjs';
import { requireThat } from './errors.mjs';
import { now } from './store.mjs';

const stopped=s=>['idle','finished','failed'].includes(s.status);
const running=s=>['preparing','printing','paused'].includes(s.status);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const settingsKeys=['useAms','amsMapping','filamentMapping','nozzleMapping','bedType','bedLeveling','timelapse','flowCalibration','vibrationCalibration','nozzleOffsetCalibration'];

export class ProductionService {
  constructor({service,store,config}) {
    Object.assign(this,{service,store,config});service.production=this;this.busy=new Set();
    this.listener=(id,s)=>this.observe(id,s);
    service.transport.on('telemetry',this.listener);
    // Recovery never uploads, starts, stops, or advances a queue.
    for(const p of store.printers()) {
      const a=store.active(p.id);if(!a)continue;
      if(a.state!=='awaiting_collection') {
        a.state='review';a.detail='Agente reiniciado; espera telemetría o concilia el intento.';
        store.saveAttempt(a);store.saveJob({...store.job(a.jobId),state:'review'});
      }
    }
  }
  close(){this.service.transport.off('telemetry',this.listener);if(this.service.production===this)delete this.service.production;}
  receipt(scope,key,input) {
    requireThat(typeof key==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(key),'REQUEST_KEY','Se requiere Idempotency-Key de 8 a 100 caracteres.');
    const fingerprint=hash(input),previous=this.store.productionRequest(scope,key);
    if(previous)requireThat(previous.fingerprint===fingerprint,'KEY_REUSED','Esa clave ya pertenece a otra solicitud.',409);
    return {previous:previous?.result,save:result=>this.store.saveProductionRequest(scope,key,fingerprint,result)};
  }
  item(id) {const item=this.store.libraryItem(id);requireThat(item,'NOT_FOUND','Archivo de biblioteca no encontrado.',404);return item;}
  deleteLibrary(input,key) {
    requireThat(Array.isArray(input.ids)&&input.ids.length>0&&input.ids.length<=500&&input.ids.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)),'LIBRARY_IDS','Selecciona de 1 a 500 archivos válidos.');
    const ids=[...new Set(input.ids)].sort(),r=this.receipt('library-delete',key,{ids});
    if(r.previous)return r.previous;
    return this.store.transaction(()=>{
      const items=ids.map(id=>this.item(id)),deletedAt=now();
      // Keep the immutable file and metadata for existing jobs, consumption and history.
      // Importing the same sliced file again restores it to the visible library.
      for(const item of items)if(!item.deletedAt){
        this.store.updateLibrary({...item,deletedAt});
        this.store.event(null,'library-deleted',{libraryId:item.id,name:item.name});
      }
      const result={deletedIds:ids};r.save(result);return result;
    });
  }
  file(id) {this.item(id);return path.join(this.config.dataDir,'library',`${id}.gcode.3mf`);}
  async importFile(source,name) {
    const directory=path.join(this.config.dataDir,'library');await mkdir(directory,{recursive:true});
    const temporary=path.join(directory,`${crypto.randomUUID()}.incoming`);
    try {
      requireThat((await stat(source)).size<=this.config.maxUploadBytes,'UPLOAD_SIZE','Archivo demasiado grande.',413);
      await copyFile(source,temporary);
      const bytes=(await stat(temporary)).size;
      requireThat(bytes<=this.config.maxUploadBytes,'UPLOAD_SIZE','Archivo demasiado grande.',413);
      const archive=await inspectArchive(temporary);
      requireThat(archive.plates.every(p=>['P1S','A1','X1C','X2D'].includes(p.model)&&p.nozzleDiameters.length>0),'PROFILE_REQUIRED','El archivo debe identificar modelo y boquillas.');
      const id=archive.sha256;
      // Copy even on deduplication: it also repairs a missing/corrupted local copy.
      await rename(temporary,path.join(directory,`${id}.gcode.3mf`));
      const existing=this.store.libraryItem(id);
      if(existing?.deletedAt){
        const {deletedAt,...restored}=existing;
        this.store.transaction(()=>{this.store.updateLibrary(restored);this.store.event(null,'library-restored',{libraryId:id});});
        return restored;
      }
      if(existing)return existing;
      const item={id,name:String(name||path.basename(source)).slice(0,160),bytes,createdAt:now(),...archive};
      this.store.saveLibrary(item);this.store.event(null,'library-imported',{libraryId:id,plates:item.plates.length});return this.item(id);
    } finally {await unlink(temporary).catch(()=>{});}
  }
  settings(input={}) {
    requireThat(input&&typeof input==='object'&&!Array.isArray(input),'SETTINGS','settings debe ser un objeto.');
    for(const key of Object.keys(input))requireThat(settingsKeys.includes(key),'SETTINGS',`Opción de impresión desconocida: ${key}.`);
    return structuredClone(input);
  }
  compatible(printer,plate) {
    requireThat(plate,'PLATE','La placa no existe en el archivo.');
    requireThat(plate.model===printer.model,'WRONG_MODEL','El archivo no corresponde al modelo de impresora.');
    requireThat(JSON.stringify(plate.nozzleDiameters)===JSON.stringify(printer.nozzleDiameters),'WRONG_NOZZLE','Las boquillas del archivo no coinciden con la impresora.');
  }
  job(id,printerId) {const job=this.store.job(id);requireThat(job&&job.printerId===printerId,'NOT_FOUND','Trabajo no encontrado en esta impresora.',404);return job;}
  result(attemptId) {const attempt=this.store.attempt(attemptId);return {job:this.store.job(attempt.jobId),attempt,
    startOperation:this.store.request(attempt.printerId,attempt.startKey)||null,
    stopOperation:attempt.failureKey?this.store.request(attempt.printerId,attempt.failureKey)||null:null,
    collection:this.store.collection(attemptId)||null,materialUsage:this.store.usage(attemptId)||null,
    recovery:{available:this.canRecoverStart(attempt)},
    operatorCollection:{available:this.canOperatorCollect(attempt)},
    materialPlan:attempt.state==='review'?this.inventory?.plan(this.store.job(attempt.jobId))||null:null};}
  collectionMatches(a,s) {
    if(a.collectionConflict)return false;
    if(this.matches(a,s))return true;
    if(s.currentJob?.name||s.currentJob?.file)return false;
    const stop=a.failureKey&&this.store.request(a.printerId,a.failureKey);
    if(a.failureRequested&&stop?.status==='confirmed')return true;
    // Some printers clear the job name after finishing. Preserve the positively
    // identified terminal report instead of requiring the name to remain forever.
    return !!(a.terminalTelemetry&&['finished','failed'].includes(a.terminalTelemetry.status)&&this.matches(a,a.terminalTelemetry));
  }
  canOperatorCollect(a) {
    if(!a||this.store.active(a.printerId)?.id!==a.id||a.state!=='awaiting_collection')return false;
    const s=this.service.transport.status(a.printerId);
    return !!(s.fresh&&stopped(s)&&this.collectionMatches(a,s)&&
      (this.inventory?.enforceFilamentChecks()===false||this.store.usage(a.id)?.status!=='needs_review')&&!this.store.pending(a.printerId).length&&
      !this.busy.has(a.printerId)&&!this.service.locks.has(a.printerId));
  }
  canRecoverStart(a) {
    if(!a||this.store.active(a.printerId)?.id!==a.id||a.state!=='review')return false;
    const s=this.service.transport.status(a.printerId),op=this.store.request(a.printerId,a.startKey);
    return !!(s.fresh&&stopped(s)&&!this.matches(a,s)&&
      !a.observedStartedAt&&!a.lastTelemetry&&!a.terminalTelemetry&&!a.materialProgress&&!a.failureRequested&&!a.failureKey&&
      !a.materialRoutingUncertain&&!this.store.usage(a.id)&&!this.store.collection(a.id)&&
      ['rejected','resolved'].includes(op?.status)&&!this.store.pending(a.printerId).length&&
      !this.busy.has(a.printerId)&&!this.service.locks.has(a.printerId));
  }
  recoverStart(id,attemptId,input,key) {
    this.service.printer(id);
    const r=this.receipt(`recover-start:${id}:${attemptId}`,key,input);
    if(r.previous)return r.previous;
    const a=this.store.active(id);
    requireThat(a?.id===attemptId,'NOT_ACTIVE','Ese intento ya no está activo.',409);
    requireThat(this.canRecoverStart(a),'OPERATOR_REVIEW','El intento necesita revisión del encargado; no se puede devolver a la cola.',409);
    requireThat(input.neverStarted===true&&input.noFilamentUsed===true&&input.bedCleared===true,'REVIEW_REQUIRED','Confirma que no comenzó, no salió filamento y la base está vacía.');
    const action=input.action??'retry';
    requireThat(['retry','skip'].includes(action),'RECOVERY_ACTION','Elige repetir este trabajo o seguir con la cola.');
    // Record the failed dispatch separately. Reuse the same queue job, without
    // producing pieces, changing its position or sending another printer command.
    return this.store.transaction(()=>{
      const recoveredAt=now(),closed={...a,state:'recovered',outcome:'aborted',notStartedConfirmedAt:recoveredAt,
        recovery:{neverStarted:true,noFilamentUsed:true,bedCleared:true,action,at:recoveredAt}};
      this.inventory?.finish(closed,'aborted');
      this.store.saveAttempt(closed);this.store.release(id,a.id);
      const job=this.store.job(a.jobId);
      this.store.saveJob({...job,state:action==='skip'?'cancelled':'queued',attemptId:action==='skip'?a.id:undefined,
        ...(action==='skip'?{cancelledAt:recoveredAt,cancelReason:'El operador confirmó que no comenzó y eligió seguir la cola.'}:{})});
      this.inventory?.replan();
      const result={jobId:job.id,attemptId:a.id,requeued:action==='retry',skipped:action==='skip',automaticStart:false};
      this.store.event(id,'start-recovered',result);r.save(result);return result;
    });
  }
  queue(id) {
    this.service.printer(id);const all=this.store.jobs(id),active=this.store.active(id);
    const counts={plannedPieces:0,good:0,rejected:0,unproduced:0,remainingTargetPieces:0};
    const madeByRoot=new Map();for(const j of all)madeByRoot.set(j.rootId,(madeByRoot.get(j.rootId)||0)+(j.collection?.good||0));
    for(const j of all) {
      const c=j.collection;
      if(!j.retryOf&&j.state!=='cancelled') {
        counts.plannedPieces+=j.pieces;
        const made=madeByRoot.get(j.id)||0;
        counts.remainingTargetPieces+=Math.max(0,j.pieces-made);
      }
      if(c){counts.good+=c.good;counts.rejected+=c.rejected;counts.unproduced+=c.unproduced;}
    }
    return {printerId:id,active:active?this.result(active.id):null,
      pending:all.filter(j=>j.state==='queued').map(j=>({...j,materialPlan:this.inventory?.plan(j)||this.store.materialPlan(j.id)||null})),history:all.filter(j=>['collected','cancelled'].includes(j.state)).slice(-200),
      counts,telemetry:this.service.transport.status(id),automaticStart:false};
  }
  add(id,input,key) {
    const printer=this.service.printer(id),r=this.receipt(`add:${id}`,key,input);
    if(r.previous)return {jobs:r.previous.ids.map(j=>this.store.job(j))};
    const item=this.item(input.libraryId),plate=item.plates.find(p=>p.index===input.plate);this.compatible(printer,plate);
    requireThat(!item.deletedAt,'LIBRARY_DELETED','Este archivo fue borrado de la biblioteca. Vuelve a importarlo para crear un trabajo nuevo.',409);
    requireThat(integer(input.piecesPerPlate,1,10000),'QUANTITY','Confirma de 1 a 10000 piezas por placa. El número de objetos del slicer es solo una referencia.');
    const repetitions=input.repetitions??1;requireThat(integer(repetitions,1,500),'QUANTITY','Usa de 1 a 500 repeticiones.');
    const settings=this.settings(input.settings);
    const materialChange=this.inventory?.normalizeChange(id,plate,settings,input.materialChange)||null;
    const prior=this.store.jobs(id);requireThat(prior.filter(j=>j.state==='queued').length+repetitions<=10000,'QUEUE_FULL','La cola admite hasta 10000 placas pendientes.',409);
    const position=prior.reduce((n,j)=>Math.max(n,j.position),0),batchId=crypto.randomUUID();
    return this.store.transaction(()=>{
      const jobs=Array.from({length:repetitions},(_,i)=>{
        const jobId=crypto.randomUUID();
        return this.store.saveJob({id:jobId,rootId:jobId,batchId,printerId:id,libraryId:item.id,plate:input.plate,pieces:input.piecesPerPlate,
          label:String(input.label||item.name).slice(0,160),repetition:i+1,repetitions,settings,materialChange,position:position+i+1,state:'queued',createdAt:now()});
      });this.inventory?.replan();r.save({ids:jobs.map(j=>j.id)});return {jobs};
    });
  }
  edit(id,jobId,input,key) {
    const r=this.receipt(`edit:${jobId}`,key,input);if(r.previous)return this.job(jobId,id);
    const job=this.job(jobId,id);requireThat(job.state==='queued','WRONG_STATE','Solo puedes editar un trabajo en cola.',409);
    const settings=this.settings(input.settings??job.settings);
    const plate=this.item(job.libraryId).plates.find(p=>p.index===job.plate);
    const materialChange=this.inventory?.normalizeChange(id,plate,settings,input.materialChange===undefined?job.materialChange:input.materialChange)||null;
    return this.store.transaction(()=>{const out=this.store.saveJob({...job,settings,materialChange,label:String(input.label??job.label).slice(0,160)});this.inventory?.replan();r.save({id:jobId});return out;});
  }
  reorder(id,input,key) {
    this.service.printer(id);const r=this.receipt(`reorder:${id}`,key,input);if(r.previous)return this.queue(id);
    const queued=this.store.jobs(id).filter(j=>j.state==='queued'),ids=input.jobIds;
    requireThat(Array.isArray(ids)&&ids.length===queued.length&&new Set(ids).size===ids.length&&queued.every(j=>ids.includes(j.id)),'QUEUE_CHANGED','Incluye todos los IDs actualmente en cola una sola vez; vuelve a consultar si cambió.',409);
    const positions=queued.map(j=>j.position).sort((a,b)=>a-b);
    this.store.transaction(()=>{ids.forEach((jobId,i)=>this.store.saveJob({...this.job(jobId,id),position:positions[i]}));this.inventory?.replan();r.save({ok:true});});return this.queue(id);
  }
  cancel(id,jobId,input,key) {
    const r=this.receipt(`cancel:${jobId}`,key,input);if(r.previous)return this.job(jobId,id);
    const job=this.job(jobId,id);requireThat(job.state==='queued','WRONG_STATE','Solo puedes cancelar placas que siguen en cola. Para una impresión activa usa failed o stop.',409);
    return this.store.transaction(()=>{const out=this.store.saveJob({...job,state:'cancelled',cancelledAt:now()});this.inventory?.replan();r.save({id:jobId});return out;});
  }
  guardCommand(id,kind,context) {
    const a=this.store.active(id);
    if(kind==='start')requireThat(!a || a.id===context.attemptId,'COLLECTION_REQUIRED','Esta impresora tiene un intento abierto. Recolecta o concílialo antes de iniciar otra placa.',409);
    if(kind==='start'&&this.inventory) {
      requireThat(a?.id===context.attemptId&&(this.inventory.enforceFilamentChecks()===false||a?.allocations?.length),'QUEUE_REQUIRED','Inicia desde la cola para asignar y contabilizar los rollos.',409);
      this.inventory.checkActive(a,this.service.transport.status(id));
    }
  }
  async dispatch(id,input,key) {
    const printer=this.service.printer(id),r=this.receipt(`dispatch:${id}`,key,input);
    if(r.previous)return this.result(r.previous.attemptId);
    requireThat(!this.store.active(id),'COLLECTION_REQUIRED','Hay un intento abierto; la cama aún no se liberó.',409);
    const job=this.job(input.jobId,id),head=this.store.jobs(id).find(j=>j.state==='queued');
    requireThat(job.state==='queued'&&head?.id===job.id,'QUEUE_ORDER','Selecciona la primera placa en cola o reordena la cola.',409);
    const item=this.item(job.libraryId),status=this.service.transport.status(id);
    requireThat(status.fresh&&stopped(status),'WRONG_STATE','Espera telemetría actual y una impresora detenida.',409);
    requireThat(!this.store.pending(id).length&&!this.service.locks.has(id),'UNRESOLVED_COMMAND','Hay otra operación pendiente. Revisa su resultado.',409);
    requireThat(!status.errors?.printError,'PRINTER_ERROR','Resuelve el error activo antes de iniciar.',409);
    // Validate current material assignments before even uploading. Confirmations are per dispatch.
    buildStart({printer,transfer:{archive:item,remoteName:'preflight.gcode.3mf'},status,enforceFilamentChecks:this.inventory?.enforceFilamentChecks()!==false,
      input:{...job.settings,plate:job.plate,bedCleared:input.bedCleared,setupConfirmed:input.setupConfirmed},sequence:'0',operationId:'preflight'});
    const attemptId=crypto.randomUUID(),a={id:attemptId,jobId:job.id,printerId:id,state:'uploading',createdAt:now(),
      startKey:`queue-start-${attemptId}`,before:status,settings:job.settings};
    this.store.transaction(()=>{
      if(this.inventory)a.allocations=this.inventory.prepare(job,status);
      if(this.inventory?.enforceFilamentChecks()===false)a.untrackedFilamentIds=item.plates.find(p=>p.index===job.plate).filaments.filter(f=>!a.allocations.some(l=>l.filamentId===f.id)).map(f=>f.id);
      this.store.saveAttempt(a);this.store.claim(id,a.id);this.store.saveJob({...job,state:'dispatching',attemptId:a.id});this.inventory?.replan();r.save({attemptId:a.id});
    });
    this.busy.add(id);
    try {
      requireThat(await sha256(this.file(item.id))===item.sha256,'LIBRARY_CORRUPTED','El archivo guardado cambió. Vuelve a importar el original.',409);
      const transfer=await this.service.upload(id,this.file(item.id));
      this.store.saveAttempt({...this.store.attempt(a.id),transferId:transfer.id,state:'dispatching'});
      const operation=await this.service.command(id,'start',{...job.settings,plate:job.plate,transferId:transfer.id,
        bedCleared:input.bedCleared,setupConfirmed:input.setupConfirmed},a.startKey,{attemptId:a.id});
      const current=this.store.attempt(a.id);current.operationId=operation.id;
      if(['rejected','uncertain'].includes(operation.status)&&current.state==='dispatching')current.state='review';
      this.store.saveAttempt(current);
      this.store.saveJob({...this.store.job(job.id),state:current.state==='review'?'review':current.state==='dispatching'?'dispatching':current.state==='awaiting_collection'?'awaiting_collection':'active'});
      this.observe(id,this.service.transport.status(id));
    } catch(error) {
      const op=this.store.request(id,a.startKey);
      const current={...this.store.attempt(a.id),state:op?'review':'not_sent',detail:error.code||'DISPATCH_FAILED'};
      this.store.transaction(()=>{
        this.store.saveAttempt(current);
        this.store.saveJob({...this.store.job(job.id),state:op?'review':'queued'});
        if(!op)this.store.release(id,a.id);
        this.inventory?.replan();
      });
    } finally {this.busy.delete(id);}
    return this.result(a.id);
  }
  matches(a,s) {
    const op=this.store.request(a.printerId,a.startKey),p=op?.packet?.print;
    return !!p&&!!((p.subtask_name&&s.currentJob?.name===p.subtask_name)||(p.file&&(s.currentJob?.file?.split('/').at(-1)===p.file||s.currentJob?.name===p.file)));
  }
  observe(id,s) {
    const a=this.store.active(id);if(!a||!s.fresh)return;
    if(a.state==='awaiting_collection') {
      if(!a.collectionConflict&&(running(s)||((s.currentJob?.name||s.currentJob?.file)&&!this.matches(a,s)))) {
        this.store.saveAttempt({...a,collectionConflict:true,detail:'Se observó otra actividad después de terminar. Revisa la placa antes de recolectar.'});
      }
      return;
    }
    const op=this.store.request(id,a.startKey);if(!op||!s.stateSeenAt||Date.parse(s.stateSeenAt)<Date.parse(op.createdAt))return;
    const matched=this.matches(a,s);
    const stopOp=a.failureKey&&this.store.request(id,a.failureKey);
    if(matched) {
      a.lastTelemetry=s;a.operationId=op.id;
      this.inventory?.track(a,s);
      if(running(s)){a.state=s.status;a.observedStartedAt??=now();}
      else if(['finished','failed'].includes(s.status)) {
        a.state='awaiting_collection';a.outcome=a.failureRequested||s.status==='failed'?'failed':'finished';a.terminalTelemetry=s;a.endedAt=now();
      } else if(a.observedStartedAt){a.state='review';a.detail='La máquina volvió a idle sin resultado final; concilia la impresión.';}
    } else if(running(s)) {a.state='review';a.detail='La impresora reporta otro trabajo. No se le atribuyó producción.';}
    if(a.failureRequested&&stopped(s)&&stopOp?.status==='confirmed') {
      a.state='awaiting_collection';a.outcome='failed';a.terminalTelemetry=s;a.endedAt=now();
    }
    if(['rejected','uncertain','resolved'].includes(op.status)&&['uploading','dispatching'].includes(a.state)) {a.state='review';a.detail=`Inicio ${op.status}; requiere revisión.`;}
    this.store.transaction(()=>{
      this.store.saveAttempt(a);this.store.saveJob({...this.store.job(a.jobId),state:a.state==='awaiting_collection'?'awaiting_collection':a.state==='review'?'review':a.state==='dispatching'?'dispatching':'active'});
      if(a.state==='awaiting_collection'&&this.inventory){this.inventory.finish(a,a.outcome);this.inventory.replan();}
    });
  }
  async fail(id,attemptId,input,key) {
    const r=this.receipt(`fail:${attemptId}`,key,input);if(r.previous)return this.result(attemptId);
    const a=this.store.active(id);requireThat(a?.id===attemptId,'NOT_ACTIVE','Ese intento ya no está activo.',409);
    requireThat(!a.failureRequested,'ALREADY_FAILED','La falla ya está registrada. Consulta el intento y su operación stop.',409);
    requireThat(typeof input.reason==='string'&&input.reason.trim().length>=3,'REASON','Indica el motivo de la falla.');
    const s=this.service.transport.status(id);
    requireThat(s.fresh&&(running(s)||stopped(s)),'STALE','Espera telemetría actual para registrar y detener.',409);
    requireThat(this.matches(a,s)||(a.state==='awaiting_collection'&&stopped(s)&&this.collectionMatches(a,s)),'JOB_MISMATCH','El trabajo actual no coincide. Revisa la máquina antes de usar un stop manual.',409);
    requireThat(!this.busy.has(id)&&!this.service.locks.has(id),'BUSY','Espera a que termine el envío del inicio.',409);
    a.failureRequested=true;a.failureReason=input.reason.slice(0,500);a.failureAt=now();a.failureTelemetry=s;a.failureKey=`queue-stop-${a.id}`;
    if(this.matches(a,s))this.inventory?.track(a,s);
    if(stopped(s)){a.state='awaiting_collection';a.outcome='failed';a.endedAt=now();if(this.matches(a,s))a.terminalTelemetry=s;}
    this.store.transaction(()=>{
      this.store.saveAttempt(a);this.store.saveJob({...this.store.job(a.jobId),state:a.state==='awaiting_collection'?'awaiting_collection':'active'});
      if(a.state==='awaiting_collection'&&this.inventory){this.inventory.finish(a,a.outcome);this.inventory.replan();}r.save({attemptId});
    });
    if(running(s)) {
      try {await this.service.command(id,'stop',{},a.failureKey,{attemptId:a.id});}
      catch(error) {this.store.saveAttempt({...this.store.attempt(a.id),detail:`Falla registrada; stop no enviado: ${error.code||'ERROR'}. Revisa la máquina.`});}
      this.observe(id,this.service.transport.status(id));
    }
    return this.result(a.id);
  }
  collect(id,attemptId,input,key,completedReceipt=null) {
    const r=this.receipt(`collect:${attemptId}`,key,input);if(r.previous)return this.result(attemptId);
    requireThat(!this.store.collection(attemptId),'ALREADY_COLLECTED','Esta recolección ya fue contabilizada.',409);
    const a=this.store.active(id);requireThat(a?.id===attemptId,'NOT_ACTIVE','Intento no activo.',409);
    requireThat(!this.busy.has(id)&&!this.service.locks.has(id),'BUSY','Espera a que termine la operación en curso.',409);
    const s=this.service.transport.status(id);
    requireThat(s.fresh&&stopped(s),'WRONG_STATE','Para recolectar, la impresora debe estar detenida y con telemetría actual.',409);
    requireThat(input.bedCleared===true,'BED_REQUIRED','Confirma piezas retiradas y cama despejada.');
    const reviewed=input.printerChecked===true&&typeof input.note==='string'&&input.note.trim().length>=5;
    const manual=a.state!=='awaiting_collection'||!this.collectionMatches(a,s);
    if(manual)requireThat(reviewed,'REVIEW_REQUIRED','Confirma revisión física y deja una nota del resultado; no hay un final atribuible confirmado.',409);
    requireThat(!this.store.pending(id).length,'UNRESOLVED_COMMAND','Concilia primero las operaciones inciertas o pendientes.',409);
    const job=this.store.job(a.jobId),outcome=input.outcome??a.outcome;
    requireThat(['finished','failed','aborted'].includes(outcome),'OUTCOME','Indica finished, failed o aborted.');
    if(a.failureRequested||a.outcome==='failed')requireThat(outcome==='failed','OUTCOME','La falla registrada debe conservarse como failed.');
    const good=input.good,rejected=input.rejected;
    requireThat(integer(good,0,job.pieces)&&integer(rejected,0,job.pieces)&&good+rejected<=job.pieces,'COUNTS','Piezas buenas y rechazadas no pueden superar la capacidad de la placa.');
    requireThat(outcome!=='finished'||good+rejected===job.pieces,'COUNTS','Al finalizar clasifica todas las piezas de la placa.');
    requireThat(outcome!=='aborted'||good+rejected===0,'COUNTS','aborted se usa cuando no se produjo ninguna pieza.');
    const retryFirst=input.retryWholePlateFirst===true;
    requireThat(!retryFirst||(outcome==='failed'&&good===0&&rejected===job.pieces),'RETRY_COUNTS','El reintento rápido requiere confirmar que ninguna pieza sirve.');
    const c={attemptId:a.id,jobId:job.id,printerId:id,good,rejected,unproduced:job.pieces-good-rejected,outcome,
      bedCleared:true,printerChecked:reviewed,note:String(input.note||'').slice(0,500),at:now()};
    this.store.transaction(()=>{
      if(this.inventory) {
        const usage=this.inventory.finish(a,outcome,input.usage);
        requireThat(usage.status!=='needs_review','USAGE_REVIEW','Falta consumo/progreso del intento. Incluye usage al recolectar o corrige su consumo.',409);
      }
      this.store.saveCollection(c);this.store.saveAttempt({...a,state:'collected',outcome,collectedAt:c.at});
      this.store.saveJob({...job,state:'collected',collection:c});this.store.release(id,a.id);r.save({attemptId:a.id});
      if(retryFirst) {
        // Collection, retry and its position commit together, including after a
        // lost response. Never dispatch automatically from a collection.
        const all=this.store.jobs(id),retryId=crypto.randomUUID();
        const remaining=Math.max(0,this.store.job(job.rootId).pieces-all.filter(j=>j.rootId===job.rootId).reduce((n,j)=>n+(j.collection?.good||0),0));
        requireThat(remaining>0,'TARGET_MET','El objetivo de piezas buenas ya está completo.',409);
        const retry={...job,id:retryId,retryOf:job.id,retryJobId:undefined,attemptId:undefined,collection:undefined,
          position:Math.min(...all.map(j=>j.position),0)-1,state:'queued',createdAt:now(),
          remainingTargetAtCreation:remaining,possibleSurplus:Math.max(0,job.pieces-remaining)};
        this.store.saveJob(retry);this.store.saveJob({...this.store.job(job.id),retryJobId:retryId});
      }
      this.inventory?.replan();
      this.store.event(id,'collected',c);
      completedReceipt?.save({attemptId});
    });return this.result(a.id);
  }
  operatorCollect(id,attemptId,input,key) {
    // Replay the exact completed action, but never reinterpret a newer plate.
    const r=this.receipt(`operator-collect:${attemptId}`,key,input);
    if(r.previous)return this.result(attemptId);
    const a=this.store.active(id),s=this.service.transport.status(id);
    requireThat(a?.id===attemptId&&a.state==='awaiting_collection','OPERATOR_REVIEW','Espera a que termine. Si pide revisión, llama al encargado.',409);
    requireThat(input.bedCleared===true&&input.printerChecked===true,'BED_REQUIRED','Confirma que retiraste las piezas y la base está puesta y vacía.');
    requireThat(typeof input.retry==='boolean','RETRY_REQUIRED','Elige si quieres repetir esta placa.');
    const failed=a.failureRequested||a.outcome==='failed';
    requireThat(input.outcome===(failed?'failed':'finished'),'OUTCOME_CHANGED','El resultado cambió. Vuelve a revisar esta impresora.',409);
    requireThat(!input.retry||failed,'RETRY_FINISHED','Esta placa terminó bien; sigue con la cola.');
    requireThat(this.collectionMatches(a,s),'OPERATOR_REVIEW','La impresora muestra otro trabajo. Pide apoyo al encargado.',409);
    // collect() retains fresh telemetry, stopped state, pending command and
    // filament-accounting checks. Its receipt also survives a restart here.
    const job=this.store.job(a.jobId);
    const result=this.collect(id,attemptId,{good:failed?0:job.pieces,rejected:failed?job.pieces:0,
      outcome:failed?'failed':'finished',bedCleared:true,printerChecked:true,
      note:failed?'Operador: ninguna pieza sirve; retiré todo y la base está vacía.':'Operador: todas las piezas salieron bien; retiré todo y la base está vacía.',
      retryWholePlateFirst:input.retry},`operator-${hash(key).slice(0,64)}`,r);
    return result;
  }
  retry(id,jobId,input,key) {
    const r=this.receipt(`retry:${jobId}`,key,input);if(r.previous)return this.job(r.previous.id,id);
    const job=this.job(jobId,id);requireThat(job.state==='collected','WRONG_STATE','Recolecta la placa antes de crear su reintento.',409);
    requireThat(!job.retryJobId||this.store.job(job.retryJobId)?.state==='cancelled','RETRY_EXISTS','Ya existe un reintento para esta placa; consulta ese trabajo.',409);
    requireThat(input.wholePlateConfirmed===true,'WHOLE_PLATE','El archivo reimprime la placa completa. Confirma wholePlateConfirmed, o importa una placa sliceada con menos piezas.');
    const all=this.store.jobs(id),root=this.store.job(job.rootId);
    const made=all.filter(j=>j.rootId===job.rootId).reduce((n,j)=>n+(j.collection?.good||0),0);
    requireThat(made<root.pieces,'TARGET_MET','El objetivo de piezas buenas de esta placa ya se alcanzó.',409);
    const retry={...job,id:crypto.randomUUID(),retryOf:job.id,retryJobId:undefined,attemptId:undefined,collection:undefined,
      position:all.reduce((n,j)=>Math.max(n,j.position),0)+1,state:'queued',createdAt:now(),remainingTargetAtCreation:root.pieces-made,
      possibleSurplus:Math.max(0,job.pieces-(root.pieces-made))};
    this.store.transaction(()=>{this.store.saveJob(retry);this.store.saveJob({...job,retryJobId:retry.id});this.inventory?.replan();r.save({id:retry.id});});return retry;
  }
}
