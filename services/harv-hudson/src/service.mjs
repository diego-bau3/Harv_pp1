import crypto from 'node:crypto';
import { stat } from 'node:fs/promises';
import { requireThat,HudsonError } from './errors.mjs';
import { isLanIp } from './discovery.mjs';
import { canonicalModel,inspectArchive } from './archive.mjs';
import { buildStart } from './commands.mjs';
import { now } from './store.mjs';

const SUPPORTED=new Set(['X1C','X2D','P1S','A1']);
const intentHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class HudsonService {
  constructor({store,vault,transport,config}) {
    Object.assign(this,{store,vault,transport,config});this.locks=new Set();this.registering=false;
    this.store.recover();
    transport.on('ack',(id,ack)=>this.handleAck(id,ack));
    transport.on('telemetry',(id,status)=>this.reconcile(id,status));
    transport.on('connection',(id,state)=>this.store.event(id,'connection',{state}));
    transport.on('diagnostic',(id,code)=>this.store.event(id,'diagnostic',{code}));
    this.timer=setInterval(()=>this.expire(),1000);this.timer.unref();
  }
  async initialize() { for(const p of this.store.printers()) await this.transport.connect(p); }
  printer(id) { const p=this.store.printer(id);requireThat(p,'NOT_FOUND','Impresora no encontrada.',404);return p; }
  list() { return this.store.printers().map(p=>({...p,hasAccessCode:true,enforceFilamentChecks:this.production?.inventory?.enforceFilamentChecks()!==false,telemetry:this.transport.status(p.id)})); }
  async register(input) {
    requireThat(!this.config.requireExclusiveControl || input.exclusiveControlConfirmed===true,'EXCLUSIVE_CONTROL','Confirma que Hudson original y otros gestores no controlan esta impresora.',409);
    requireThat(!this.registering,'BUSY','Hay otra vinculación en curso.',409);this.registering=true;
    try {
      requireThat(isLanIp(input.ipAddress),'INVALID_IP','Usa una dirección IPv4 de tu red local.');
      requireThat(/^[A-Za-z0-9_-]{6,40}$/.test(input.serial || ''),'INVALID_SERIAL','Número de serie inválido.');
      const model=canonicalModel(input.model);requireThat(SUPPORTED.has(model),'INVALID_MODEL','Modelos: X1C, X2D, P1S y A1.');
      const existing=this.store.printers().find(p=>p.serial===input.serial);
      requireThat(!this.store.printers().some(p=>p.ipAddress===input.ipAddress&&p.serial!==input.serial),'DUPLICATE_IP','Esa IP ya pertenece a otra impresora.');
      if(existing) requireThat(!this.store.pending(existing.id).length&&!this.locks.has(existing.id)&&!this.store.active(existing.id),'BUSY','Cierra el intento y los comandos pendientes antes de cambiar la conexión.',409);
      const accessCode=input.accessCode;
      if(accessCode!==undefined) requireThat(typeof accessCode==='string'&&accessCode.length>=6&&accessCode.length<=64,'ACCESS_CODE','Código de acceso LAN inválido.');
      requireThat(existing || (typeof accessCode==='string'&&accessCode.length>=6&&accessCode.length<=64),'ACCESS_CODE','Falta el código de acceso LAN.');
      const nozzleDiameters=input.nozzleDiameters || existing?.nozzleDiameters;
      requireThat(Array.isArray(nozzleDiameters)&&nozzleDiameters.length>=1&&nozzleDiameters.length<=2&&nozzleDiameters.every(n=>[0.2,0.4,0.6,0.8].includes(n)),'NOZZLE','Indica los diámetros de boquilla instalados.');
      requireThat(nozzleDiameters.length===(model==='X2D'?2:1),'NOZZLE','X2D requiere dos diámetros en orden del perfil; los otros modelos, uno.');
      for(const key of ['mqttPort','ftpPort']) if(input[key]!==undefined) requireThat(Number.isInteger(input[key])&&input[key]>0&&input[key]<=65535,'PORT','Puerto inválido.');
      const printer={id:existing?.id || crypto.randomUUID(),serial:input.serial,name:String(input.name || model).slice(0,80),model,
        ipAddress:input.ipAddress,nozzleDiameters,mqttPort:input.mqttPort || 8883,ftpPort:input.ftpPort || 990,
        createdAt:existing?.createdAt || now(),updatedAt:now()};
      const secret=accessCode ? await this.vault.protect(accessCode) : this.store.secret(existing.id);
      this.store.savePrinter(printer,secret);this.store.event(printer.id,'linked',{model});await this.transport.connect(printer);
      return {...printer,hasAccessCode:true};
    } finally {this.registering=false;}
  }
  async upload(id,file) {
    const printer=this.printer(id);requireThat(!this.locks.has(id),'BUSY','Hay otra operación para esa impresora.',409);
    this.locks.add(id);let transfer;
    try {
      const archive=await inspectArchive(file);
      requireThat(archive.plates.every(p=>p.model===printer.model),'WRONG_MODEL','El perfil del archivo no coincide con la impresora.');
      const bytes=(await stat(file)).size;
      transfer={id:crypto.randomUUID(),printerId:id,status:'uploading',archive,bytes,createdAt:now()};
      transfer.remoteName=`harv-hudson-${transfer.id}.gcode.3mf`;
      this.store.saveTransfer(transfer);
      const remote=await this.transport.upload(printer,file,transfer.remoteName);
      requireThat(remote.bytes===bytes,'UPLOAD_SIZE','El tamaño del archivo remoto no coincide. No se habilitó el inicio.',502);
      transfer.status='uploaded';transfer.uploadedAt=now();this.store.saveTransfer(transfer);
      this.store.event(id,'uploaded',{transferId:transfer.id,bytes});return transfer;
    } catch(error) {
      if(transfer){transfer.status='failed';this.store.saveTransfer(transfer);}
      if(error instanceof HudsonError) throw error;
      throw new HudsonError('UPLOAD_FAILED','No se pudo completar el envío FTPS. Revisa conexión, código LAN y almacenamiento de la impresora.',502);
    } finally {this.locks.delete(id);}
  }
  async command(id,kind,input,requestKey,context={}) {
    const printer=this.printer(id);
    requireThat(['start','pause','resume','stop'].includes(kind),'COMMAND','Comando no admitido.');
    requireThat(typeof requestKey==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(requestKey),'REQUEST_KEY','Se requiere una clave de operación única de 8 a 100 caracteres.');
    const fingerprint=intentHash({kind,input});
    const previous=this.store.request(id,requestKey);
    if(previous){requireThat(previous.fingerprint===fingerprint,'KEY_REUSED','La clave ya pertenece a otra solicitud.',409);return previous;}
    this.production?.guardCommand(id,kind,context);
    requireThat(!this.locks.has(id),'BUSY','Hay otra operación para esa impresora.',409);
    this.locks.add(id);
    try {
      const status=this.transport.status(id);
      requireThat(status.fresh,'STALE','Espera telemetría actual de la impresora antes de controlar.',409);
      const pending=this.store.pending(id);
      // Stop remains available while a start is uncertain; a second start never does.
      requireThat(kind==='stop' || pending.length===0,'UNRESOLVED_COMMAND','Hay un comando pendiente o incierto. Revisa su resultado antes de continuar.',409);
      const allowed={start:['idle','finished','failed'],pause:['printing'],resume:['paused'],stop:['printing','paused','preparing']};
      requireThat(allowed[kind].includes(status.status),'WRONG_STATE',`No se puede ${kind} en estado ${status.status}.`,409);
      if(kind==='start'||kind==='resume') requireThat(!status.errors?.printError,'PRINTER_ERROR','La impresora reporta un error activo. Resuélvelo antes de iniciar.',409);
      const op={id:crypto.randomUUID(),printerId:id,requestKey,kind,fingerprint,sequence:this.store.nextSequence(),status:'dispatching',createdAt:now(),before:status,...(context.attemptId?{attemptId:context.attemptId}:{})};
      if(kind==='start') {
        const transfer=this.store.transfer(input.transferId);
        requireThat(transfer?.printerId===id&&transfer.status==='uploaded','TRANSFER_REQUIRED','Selecciona un archivo enviado y verificado para esta impresora.');
        op.packet=buildStart({printer,transfer,status,input,sequence:op.sequence,operationId:op.id,enforceFilamentChecks:this.production?.inventory?.enforceFilamentChecks()!==false});
        op.transferId=transfer.id;
      } else {op.packet={print:{sequence_id:op.sequence,command:kind,param:''}};}
      this.store.saveOperation(op); // Durable BEFORE touching the network.
      this.store.event(id,'command-dispatch',{id:op.id,kind});
      try {
        await this.transport.publish(id,op.packet);
        const latest=this.store.operation(op.id);
        if(latest.status==='dispatching') this.store.saveOperation({...latest,status:'sent'});
      } catch {
        const latest=this.store.operation(op.id);
        if(!['confirmed','rejected'].includes(latest.status)) this.store.saveOperation({...latest,status:'uncertain',detail:'No se confirmó el envío. No se reintentará automáticamente.'});
      }
      return this.store.operation(op.id);
    } finally {this.locks.delete(id);}
  }
  handleAck(id,ack) {
    const op=this.store.pending(id).find(o=>o.sequence===String(ack.sequence_id)&&o.packet.print.command===ack.command);
    if(!op) return;
    const result=String(ack.result || '').toLowerCase();
    if(['fail','failed','error'].includes(result)) this.store.saveOperation({...op,status:'rejected',detail:String(ack.reason || 'Comando rechazado').slice(0,200)});
    else if(['success','ok'].includes(result)) this.store.saveOperation({...op,status:'acknowledged',ackAt:now()});
    // An MQTT acknowledgement alone does not mean the machine started.
  }
  reconcile(id,status) {
    if(!status.fresh) return;
    for(const op of this.store.pending(id)) {
      if(!status.stateSeenAt || Date.parse(status.stateSeenAt)<Date.parse(op.createdAt)) continue;
      let confirmed=false;
      if(op.kind==='start') {
        const name=op.packet.print.subtask_name,file=op.packet.print.file;
        const matched=status.currentJob.name===name || status.currentJob.file.split('/').at(-1)===file || status.currentJob.name===file;
        confirmed=matched&&['preparing','printing','paused','finished','failed'].includes(status.status);
      } else if(op.kind==='pause') confirmed=status.status==='paused';
      else if(op.kind==='resume') confirmed=status.status==='printing';
      else if(op.kind==='stop') confirmed=['idle','failed','finished'].includes(status.status);
      if(confirmed){this.store.saveOperation({...op,status:'confirmed',confirmedAt:now(),after:status});this.store.event(id,'command-confirmed',{id:op.id,kind:op.kind});}
    }
  }
  expire() {
    for(const p of this.store.printers()) for(const op of this.store.pending(p.id)) {
      if(op.status!=='uncertain'&&Date.now()-Date.parse(op.createdAt)>this.config.commandTimeoutMs) this.store.saveOperation({...op,status:'uncertain',detail:'Sin confirmación de estado; requiere conciliación. No se reenvió.'});
    }
  }
  resolve(id,operationId,input) {
    this.printer(id);const op=this.store.operation(operationId);
    requireThat(op?.printerId===id,'NOT_FOUND','Operación no encontrada.',404);
    requireThat(op.status==='uncertain','WRONG_STATE','Solo se concilian manualmente operaciones inciertas.',409);
    const status=this.transport.status(id);
    requireThat(status.fresh && ['idle','failed','finished'].includes(status.status),'WRONG_STATE','Espera una impresora detenida con telemetría actual.',409);
    requireThat(input.printerChecked===true&&typeof input.note==='string'&&input.note.trim().length>=5,'REVIEW_REQUIRED','Registra el resultado observado en la impresora.');
    return this.store.saveOperation({...op,status:'resolved',resolution:input.note.slice(0,500),after:status});
  }
  async close() {clearInterval(this.timer);await this.transport.close();}
}
