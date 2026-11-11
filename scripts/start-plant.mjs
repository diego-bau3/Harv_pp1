import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const forkRequire=createRequire(path.join(root,'services/harv-hudson/package.json'));
try {forkRequire.resolve('basic-ftp');forkRequire.resolve('yauzl');}
catch {console.error('Faltan dependencias de Hudson de Harv. Ejecuta npm run hudson:install.');process.exit(1);}
if(Number(process.versions.node.split('.')[0])!==24) {console.error('Harv Hudson requiere Node.js 24.');process.exit(1);}

async function availablePort(first) {
  for(let port=first;port<first+30;port++) {
    if([8787,8788].includes(port)||port>65535)continue;
    const free=await new Promise((resolve,reject)=>{
      const server=net.createServer();
      server.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));
      server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
    });
    if(free)return port;
  }
  throw new Error('No se encontro un puerto libre.');
}

const frontendPort=await availablePort(5173);
const preferred=Number(process.env.HARV_HUDSON_PORT||8789);
if(!Number.isInteger(preferred)||preferred<1024||preferred>65535||[8787,8788].includes(preferred))throw new Error('Puerto de Harv Hudson invalido.');
const hudsonPort=await availablePort(preferred);
const env={...process.env,HARV_HUDSON_PORT:String(hudsonPort),HARV_HUDSON_FRAME_ORIGINS:`http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`,VITE_HARV_HUDSON_URL:`http://127.0.0.1:${hudsonPort}`};
const children=[];let stopping=false;
function stop(code=0) {
  if(stopping)return;stopping=true;process.exitCode=code;
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
for(const args of [[path.join(root,'services/harv-hudson/src/main.mjs')],[vite,'--host','127.0.0.1','--port',String(frontendPort),'--strictPort']]) {
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});children.push(child);
  child.on('error',error=>{console.error(error.message);stop(1);});
  child.on('exit',code=>{if(!stopping)stop(code??1);});
}
console.log(`Harv: http://127.0.0.1:${frontendPort} | Hudson propio: http://127.0.0.1:${hudsonPort}`);
