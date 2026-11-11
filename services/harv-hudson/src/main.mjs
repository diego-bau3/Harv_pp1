import { open,readFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv } from './config.mjs';
import { Store } from './store.mjs';
import { WindowsVault } from './secrets.mjs';
import { getToken } from './auth.mjs';
import { BambuTransport } from './transport.mjs';
import { HudsonService } from './service.mjs';
import { createApi } from './api.mjs';
import { ProductionService } from './production.mjs';
import { InventoryService } from './inventory.mjs';
import { PrinterDiscovery } from './printer-discovery.mjs';
import { CameraService } from './cameras.mjs';
import { prepareDataDirectory } from './isolation.mjs';

const config=configFromEnv();await prepareDataDirectory(config);
const lockPath=path.join(config.dataDir,'agent.lock');
async function acquireLock(retry=true) {
  try {const file=await open(lockPath,'wx');await file.writeFile(String(process.pid));await file.close();}
  catch(error) {
    if(error.code!=='EEXIST'||!retry)throw error;
    const pid=Number(await readFile(lockPath,'utf8'));
    let alive=false;try{process.kill(pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')alive=true;}
    if(alive)throw new Error('Ya hay un agente Hudson usando estos datos.');
    await unlink(lockPath);await acquireLock(false);
  }
}
await acquireLock();
let store,service,server,production,inventory,cameras,stopping=false;
async function shutdown() {
  if(stopping)return;stopping=true;
  if(server){server.close();server.closeAllConnections();}
  cameras?.close();inventory?.close();production?.close();await service?.close();store?.close();await unlink(lockPath).catch(()=>{});
}
try {
  store=new Store(config.dataDir);const vault=new WindowsVault();const token=await getToken(store,vault);
  if(store.getSetting('ui-lan-enabled')==='true')config.host='0.0.0.0';
  const transport=new BambuTransport({store,vault,config});service=new HudsonService({store,vault,transport,config});
  production=new ProductionService({service,store,config});
  inventory=new InventoryService({store,production});
  const discoveryService=new PrinterDiscovery({store,config,credentials:async()=>new Map()});
  cameras=new CameraService({store,vault,ffmpegPath:process.env.HARV_HUDSON_FFMPEG});
  server=createApi({service,store,config,token,production,inventory,discoveryService,cameras});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});
  await service.initialize();
  console.log(`Harv / Hudson: http://${config.host}:${config.port} | ${store.printers().length} impresoras propias. Sin busqueda automatica.`);
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>shutdown().then(()=>process.exit(0)));
} catch(error) {console.error(error.message);await shutdown();process.exitCode=1;}
