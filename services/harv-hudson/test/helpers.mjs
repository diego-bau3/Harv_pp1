import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { Store } from '../src/store.mjs';
import { HudsonService } from '../src/service.mjs';
import { configFromEnv,projectDir } from '../src/config.mjs';
export const fakeVault={protect:async s=>`test-protected:${s}`,unprotect:async s=>s.replace('test-protected:','')};
export function fresh(patch={}) {return {status:'idle',fresh:true,stateSeenAt:new Date(Date.now()+1).toISOString(),currentJob:{name:'',file:''},slots:[{source:'ams',amsId:0,slotId:0,material:'PLA',empty:false}],errors:{printError:0},...patch};}
export class FakeTransport extends EventEmitter {
  constructor(){super();this.states=new Map();this.calls=[];this.failPublish=false;this.delay=null;}
  async connect(p){if(!this.states.has(p.id))this.states.set(p.id,fresh());}
  status(id){return this.states.get(id) || fresh({fresh:false});}
  async publish(id,packet){this.calls.push({id,packet});if(this.delay)await this.delay;if(this.failPublish)throw new Error('Disconnected');}
  refresh(){}
  async upload(){return {bytes:this.uploadBytes};}
  async probeStorage(){return {available:true,root:'/'};}
  async close(){}
}
export async function fixture(t) {
  const root=path.resolve(projectDir,'.test-data');await mkdir(root,{recursive:true});
  const dir=await mkdtemp(path.join(root,'case-'));
  const store=new Store(dir),transport=new FakeTransport(),config={...configFromEnv({}),requireExclusiveControl:false,dataDir:dir,commandTimeoutMs:5000};
  const service=new HudsonService({store,transport,vault:fakeVault,config});
  const printer=await service.register({name:'P1S test',model:'P1S',serial:'TESTSERIAL123',ipAddress:'192.168.1.10',nozzleDiameters:[0.4],accessCode:'test-code'});
  t.after(async()=>{await service.close();store.close();if(path.dirname(path.resolve(dir))!==root)throw new Error('Test directory outside workspace.');await rm(dir,{recursive:true,force:true});});
  const transfer={id:'transfer-1',printerId:printer.id,remoteName:'hudson-transfer.gcode.3mf',status:'uploaded',archive:{plates:[{index:1,model:'P1S',param:'Metadata/plate_1.gcode',nozzleDiameters:[0.4],filaments:[{id:1,type:'PLA'}]}]}};
  store.saveTransfer(transfer);
  return {store,transport,config,service,printer,transfer,dir};
}
export const startInput={transferId:'transfer-1',plate:1,bedCleared:true,setupConfirmed:true,useAms:true,amsMapping:[0]};
export async function writeArchive(file,{sliced=true,model='P1S',nozzles=['0.4'],xml,extra=[]}={}) {
  const zip=new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({printer_model:`Bambu Lab ${model}`,nozzle_diameter:nozzles})),'Metadata/project_settings.config');
  zip.addBuffer(Buffer.from(xml || '<config><plate><metadata key="index" value="1"/><filament id="1" type="PLA" color="#FFFFFF" used_g="30"/></plate></config>'),'Metadata/slice_info.config');
  if(sliced)zip.addBuffer(Buffer.from('; synthetic test fixture; NEVER PRINT\nG1 X0 E1'),'Metadata/plate_1.gcode');
  for(const [name,value]of extra)zip.addBuffer(Buffer.from(value),name);
  zip.end();await pipeline(zip.outputStream,createWriteStream(file));
}
