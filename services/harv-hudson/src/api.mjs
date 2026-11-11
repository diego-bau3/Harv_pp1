import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir,unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireThat,HudsonError } from './errors.mjs';
import { PrinterDiscovery } from './printer-discovery.mjs';
import { WebUI } from './web.mjs';
import { readStatistics } from './statistics.mjs';
import { PlateThumbnails } from './thumbnails.mjs';

async function jsonBody(request) {
  requireThat((request.headers['content-type'] || '').startsWith('application/json'),'CONTENT_TYPE','Se requiere application/json.',415);
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;requireThat(size<=64*1024,'BODY_SIZE','Solicitud demasiado grande.',413);chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));requireThat(value&&typeof value==='object'&&!Array.isArray(value),'BODY','Se requiere un objeto JSON.');return value;}
  catch(error){if(error instanceof HudsonError)throw error;throw new HudsonError('JSON','JSON inválido.');}
}
async function binaryUpload(request,config,receive) {
  requireThat(request.headers['content-type']==='application/octet-stream','CONTENT_TYPE','Envía el 3MF como application/octet-stream.',415);
  requireThat(Number(request.headers['content-length']||0)<=config.maxUploadBytes,'UPLOAD_SIZE','Archivo demasiado grande.',413);
  const directory=path.join(config.dataDir,'incoming');await mkdir(directory,{recursive:true});
  const file=path.join(directory,`${crypto.randomUUID()}.3mf`);let count=0;
  const limit=new Transform({transform(chunk,encoding,callback){count+=chunk.length;callback(count>config.maxUploadBytes?new HudsonError('UPLOAD_SIZE','Archivo demasiado grande.',413):null,chunk);}});
  try {await pipeline(request,limit,createWriteStream(file,{flags:'wx',mode:0o600}));return await receive(file);}
  finally {await unlink(file).catch(()=>{});}
}
export function createApi({service,store,config,token,production,inventory,discovery,discoveryService,cameras,studioCredentials=async()=>new Map()}) {
  const finder=discoveryService||new PrinterDiscovery({store,config,credentials:studioCredentials,...(discovery?{announce:discovery,scan:async()=>[]}: {})});
  let networkChanging=false;const web=new WebUI({store,config}),thumbnails=new PlateThumbnails({store,config});
  const changeLan=async enabled=>{
    if(networkChanging)return;networkChanging=true;
    const previousHost=config.host,host=enabled?'0.0.0.0':'127.0.0.1',port=server.address()?.port||config.port;
    const listen=bindHost=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,bindHost,()=>{server.removeListener('error',reject);resolve();});});
    try {
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
      await listen(host);
      config.host=host;
    } catch(error) {
      store.setSetting('ui-lan-enabled',String(previousHost==='0.0.0.0'));
      if(!server.listening)await listen(previousHost);
      throw error;
    } finally {networkChanging=false;}
  };
  const server=http.createServer(async(request,response)=>{
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>{response.statusCode=status;response.end(JSON.stringify(data));};
    try {
      const ownOrigin=web.origin(request);
      const origin=request.headers.origin;
      if(origin) {
        requireThat(origin===ownOrigin || config.frameOrigins?.includes(origin) || config.allowedOrigin && origin===config.allowedOrigin,'ORIGIN','Origen no permitido.',403);
        response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');
      }
      if(request.method==='OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key,X-Hudson-UI');
        response.writeHead(204);response.end();return;
      }
      const url=new URL(request.url,'http://hudson.local');
      if(url.pathname==='/health'&&request.method==='GET'){send(200,{name:'Harv Hudson',instanceId:'harv-hudson',version:'0.1.0',upstreamVersion:'0.4.1',ok:true,mqttDisabled:config.mqttDisabled,features:['lan-agent','sliced-library','persistent-queues','collection','production-counts','spool-inventory','material-reservations','consumption-ledger','web-dashboard']});return;}
      if(await web.handle({request,response,url,send,jsonBody,changeLan}))return;
      const incoming=Buffer.from(String(request.headers.authorization || ''));
      const expected=Buffer.from(`Bearer ${token}`);
      const bearer=incoming.length===expected.length&&crypto.timingSafeEqual(incoming,expected),session=web.session(request);
      requireThat(bearer||session,'UNAUTHORIZED','Se requiere autorización Hudson.',401);
      if(!bearer&&!['GET','HEAD'].includes(request.method))requireThat(origin===ownOrigin&&request.headers['x-hudson-ui']==='1','ORIGIN','Solicitud de sesión no permitida.',403);
      if(url.pathname==='/api/statistics'&&request.method==='GET'){send(200,readStatistics(store,Object.fromEntries(url.searchParams)));return;}
      if(url.pathname==='/api/dashboard'&&request.method==='GET'){
        send(200,{printers:service.list(),queues:production?store.printers().map(p=>production.queue(p.id)):[],library:store.library(),jobFiles:store.jobLibrary(),inventory:inventory?.overview()||{spools:[],alerts:[],plans:[]},events:store.events(),network:web.network(request),at:new Date().toISOString()});return;
      }
      if(url.pathname==='/api/printers'&&request.method==='GET'){send(200,{printers:service.list()});return;}
      if(url.pathname==='/api/printers'&&request.method==='POST'){
        const input=await jsonBody(request);
        requireThat(!config.requireExclusiveControl || input.useSavedAccessCode!==true,'MANUAL_CREDENTIAL','Harv requiere su propia vinculacion. Escribe el codigo LAN; no se importan credenciales de Hudson ni Bambu Studio.',409);
        if(input.useSavedAccessCode===true) {
          requireThat(bearer||web.local(request),'LOCAL_ONLY','Usa la PC de Hudson para importar el código guardado.',403);
          const codes=await studioCredentials(),code=codes.get(input.serial);
          requireThat(code,'STUDIO_CODE_MISSING','No hay un código LAN guardado para ese número de serie. Escríbelo desde la impresora.');
          input.accessCode=code;
        }
        send(201,{printer:await service.register(input)});return;
      }
      if(url.pathname==='/api/events'&&request.method==='GET'){send(200,{events:store.events()});return;}
      if(url.pathname==='/api/discovery/status'&&request.method==='GET'){send(200,finder.status());return;}
      if(url.pathname==='/api/discovery'&&['GET','POST'].includes(request.method)){send(200,await finder.run({force:request.method==='POST'}));return;}
      const parts=url.pathname.split('/').filter(Boolean);
      if(inventory&&parts[0]==='api') {
        const key=request.headers['idempotency-key'];
        if(parts.length===2&&parts[1]==='inventory'&&request.method==='GET'){send(200,inventory.overview());return;}
        if(parts.length===3&&parts[1]==='inventory'&&parts[2]==='policy'&&request.method==='POST'){send(200,inventory.configure(await jsonBody(request),key));return;}
        if(parts[1]==='spools') {
          if(parts.length===3&&parts[2]==='batch'&&request.method==='POST'){send(201,inventory.createBatch(await jsonBody(request),key));return;}
          if(parts.length===2&&request.method==='GET'){send(200,{spools:store.spools().map(s=>inventory.view(s.id))});return;}
          if(parts.length===2&&request.method==='POST'){send(201,{spool:inventory.create(await jsonBody(request),key)});return;}
          if(parts.length===3&&request.method==='GET'){send(200,{spool:inventory.view(parts[2])});return;}
          if(parts.length===4&&parts[3]==='ledger'&&request.method==='GET'){inventory.spool(parts[2]);send(200,{movements:store.ledger(parts[2])});return;}
          if(parts.length===4&&['adjust','edit'].includes(parts[3])&&request.method==='POST'){
            send(200,{spool:inventory[parts[3]](parts[2],await jsonBody(request),key)});return;
          }
        }
      }
      if(production&&parts[0]==='api'&&parts[1]==='library') {
        if(parts.length===6&&parts[3]==='plates'&&parts[5]==='thumbnail'&&request.method==='GET') {
          const plate=/^[1-9]\d*$/.test(parts[4])?Number(parts[4]):NaN;
          const image=await thumbnails.get(parts[2],plate);
          requireThat(image,'NO_THUMBNAIL','Este archivo no incluye una vista previa de esta placa.',404);
          response.setHeader('Content-Type','image/png');
          response.setHeader('Cache-Control','private, max-age=86400');
          response.setHeader('Cross-Origin-Resource-Policy','same-origin');
          response.end(image);return;
        }
        if(parts.length===3&&parts[2]==='delete'&&request.method==='POST'){send(200,production.deleteLibrary(await jsonBody(request),request.headers['idempotency-key']));return;}
        if(parts.length===2&&request.method==='GET'){send(200,{files:store.library()});return;}
        if(parts.length===2&&request.method==='POST') {
          send(201,{file:await binaryUpload(request,config,file=>production.importFile(file,url.searchParams.get('name')||'Archivo sliceado'))});return;
        }
        if(parts.length===3&&request.method==='GET'){send(200,{file:production.item(parts[2])});return;}
      }
      requireThat(parts[0]==='api'&&parts[1]==='printers'&&parts[2],'NOT_FOUND','Ruta no encontrada.',404);
      const id=parts[2];service.printer(id);
      if(parts.length===4&&parts[3]==='camera'&&request.method==='GET') {
        const view=cameras?.snapshot(service.printer(id))||{state:'unavailable',message:'Cámara no disponible.'};
        response.setHeader('Cross-Origin-Resource-Policy','same-origin');
        if(view.frame){response.setHeader('Content-Type','image/jpeg');response.setHeader('X-Hudson-Frame-At',String(view.at));response.end(view.frame);}
        else send(202,{state:view.state,message:view.message});
        return;
      }
      if(inventory&&parts.length===4&&parts[3]==='materials') {
        if(request.method==='GET'){send(200,{mounts:store.mounts().filter(m=>m.printerId===id),plans:store.materialPlans().filter(p=>p.printerId===id)});return;}
        if(request.method==='POST'){send(200,inventory.bind(id,await jsonBody(request),request.headers['idempotency-key']));return;}
      }
      if(inventory&&parts.length===6&&parts[3]==='attempts'&&parts[5]==='usage') {
        requireThat(store.attempt(parts[4])?.printerId===id,'NOT_FOUND','Intento no encontrado.',404);
        if(request.method==='GET'){send(200,{usage:store.usage(parts[4])||null});return;}
        if(request.method==='POST'){send(200,{usage:inventory.correct(id,parts[4],await jsonBody(request),request.headers['idempotency-key'])});return;}
      }
      if(production&&parts[3]==='queue') {
        const key=request.headers['idempotency-key'];
        if(inventory&&parts.length===6&&request.method==='POST'&&parts[5]==='confirm-filament') {
          send(200,inventory.confirmChange(id,parts[4],await jsonBody(request),key));return;
        }
        if(parts.length===4&&request.method==='GET'){send(200,production.queue(id));return;}
        if(parts.length===4&&request.method==='POST'){send(201,production.add(id,await jsonBody(request),key));return;}
        if(parts.length===5&&request.method==='POST'&&parts[4]==='dispatch'){send(202,await production.dispatch(id,await jsonBody(request),key));return;}
        if(parts.length===5&&request.method==='POST'&&parts[4]==='reorder'){send(200,production.reorder(id,await jsonBody(request),key));return;}
        if(parts.length===5&&request.method==='GET') {
          send(200,{job:production.job(parts[4],id),attempts:store.attempts(parts[4]).map(a=>production.result(a.id))});return;
        }
        if(parts.length===6&&request.method==='POST'&&['edit','cancel','retry'].includes(parts[5])){
          send(200,{job:production[parts[5]](id,parts[4],await jsonBody(request),key)});return;
        }
      }
      if(production&&parts.length===6&&parts[3]==='attempts'&&request.method==='POST'&&['fail','collect'].includes(parts[5])) {
        send(200,await production[parts[5]](id,parts[4],await jsonBody(request),request.headers['idempotency-key']));return;
      }
      if(production&&parts.length===6&&parts[3]==='attempts'&&request.method==='POST'&&parts[5]==='operator-collect') {
        send(200,production.operatorCollect(id,parts[4],await jsonBody(request),request.headers['idempotency-key']));return;
      }
      if(production&&parts.length===6&&parts[3]==='attempts'&&request.method==='POST'&&parts[5]==='recover-start') {
        send(200,production.recoverStart(id,parts[4],await jsonBody(request),request.headers['idempotency-key']));return;
      }
      if(parts.length===3&&request.method==='GET'){send(200,service.list().find(p=>p.id===id));return;}
      if(parts.length===4&&parts[3]==='refresh'&&request.method==='POST'){service.transport.refresh(id);send(202,{requested:true});return;}
      if(parts.length===4&&parts[3]==='storage'&&request.method==='GET'){
        try{send(200,await service.transport.probeStorage(service.printer(id)));}
        catch{throw new HudsonError('STORAGE_UNAVAILABLE','No se pudo acceder al almacenamiento FTPS.',502);}return;
      }
      if(parts.length===4&&parts[3]==='operations'&&request.method==='GET'){send(200,{operations:store.operations(id)});return;}
      if(parts.length===4&&parts[3]==='uploads'&&request.method==='POST') {
        send(201,{transfer:await binaryUpload(request,config,file=>service.upload(id,file))});return;
      }
      if(parts.length===5&&parts[3]==='commands'&&request.method==='POST'){
        const operation=await service.command(id,parts[4],await jsonBody(request),request.headers['idempotency-key']);send(202,{operation});return;
      }
      if(parts.length===6&&parts[3]==='operations'&&parts[5]==='resolve'&&request.method==='POST'){
        send(200,{operation:service.resolve(id,parts[4],await jsonBody(request))});return;
      }
      throw new HudsonError('NOT_FOUND','Ruta no encontrada.',404);
    } catch(error) {
      if(!response.writableEnded&&!response.destroyed) send(error instanceof HudsonError?error.status:500,{error:error instanceof HudsonError?error.code:'INTERNAL',message:error instanceof HudsonError?error.message:'Error interno. Revisa el diagnóstico local.'});
    }
  });
  server.requestTimeout=120_000;server.headersTimeout=15_000;
  server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  return server;
}
