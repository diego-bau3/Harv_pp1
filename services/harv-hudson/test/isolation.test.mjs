import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile,readFile,mkdir,readdir,symlink } from 'node:fs/promises';
import { configFromEnv,projectDir } from '../src/config.mjs';
import { prepareDataDirectory } from '../src/isolation.mjs';
import { createApi } from '../src/api.mjs';
import { PrinterDiscovery } from '../src/printer-discovery.mjs';
import { fixture } from './helpers.mjs';

test('Harv ignores original Hudson settings and cannot reuse the original or Harv Agent ports',()=>{
  const config=configFromEnv({HUDSON_PORT:'8788',HUDSON_HOST:'0.0.0.0',HUDSON_DATA_DIR:'C:/Hudson/data',HUDSON_ALLOWED_ORIGIN:'https://other.invalid',HARV_HUDSON_DATA_DIR:'C:/Hudson/data'});
  assert.equal(config.port,8789);assert.equal(config.host,'127.0.0.1');assert.equal(config.dataDir,path.join(projectDir,'data'));
  assert.equal(config.requireExclusiveControl,true);assert.equal(config.allowedOrigin,'');
  for(const port of ['8787','8788','0','NaN','65536'])assert.throws(()=>configFromEnv({HARV_HUDSON_PORT:port}));
  assert.equal(configFromEnv({HARV_HUDSON_PORT:'8790'}).port,8790);
});

test('embedding accepts only explicit loopback Harv origins, never the original service',()=>{
  for(const origin of ['*','http://127.0.0.1:8788','http://localhost:8787','https://other.invalid','http://127.0.0.1:5173/path',"http://127.0.0.1:5173; script-src *"])
    assert.throws(()=>configFromEnv({HARV_HUDSON_FRAME_ORIGINS:origin}));
  assert.deepEqual(configFromEnv({HARV_HUDSON_FRAME_ORIGINS:'http://localhost:5174'}).frameOrigins,['http://localhost:5174']);
});

test('a new data folder has its own identity and can reopen without changing it',async t=>{
  const f=await fixture(t),dataDir=path.join(f.dir,'isolated');
  await prepareDataDirectory({dataDir});
  const before=await readFile(path.join(dataDir,'installation.json'),'utf8');
  await prepareDataDirectory({dataDir});
  assert.equal(await readFile(path.join(dataDir,'installation.json'),'utf8'),before);
  assert.equal(JSON.parse(before).instanceId,'harv-hudson');
});

test('foreign data is rejected without opening, adopting or overwriting it',async t=>{
  const f=await fixture(t),dataDir=path.join(f.dir,'foreign');await mkdir(dataDir);
  await writeFile(path.join(dataDir,'hudson.sqlite'),'original-data-sentinel');
  await assert.rejects(prepareDataDirectory({dataDir}),/datos ajenos/);
  assert.equal(await readFile(path.join(dataDir,'hudson.sqlite'),'utf8'),'original-data-sentinel');
  assert.deepEqual(await readdir(dataDir),['hudson.sqlite']);
  await writeFile(path.join(dataDir,'installation.json'),JSON.stringify({instanceId:'hudson',schema:1}));
  await assert.rejects(prepareDataDirectory({dataDir}),/no pertenece/);
});

test('data folder junctions cannot redirect the fork into another installation',async t=>{
  const f=await fixture(t),target=path.join(f.dir,'target'),link=path.join(f.dir,'linked');await mkdir(target);
  await symlink(target,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareDataDirectory({dataDir:link}),/sin enlaces/);
  assert.deepEqual(await readdir(target),[]);
});

async function apiFixture(t) {
  const f=await fixture(t);f.config.requireExclusiveControl=true;
  const server=createApi({...f,token:'fork-only-token'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body={},cookie='',origin=base)=>fetch(base+route,{method:'POST',headers:{Origin:origin,'X-Hudson-UI':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  const login=await post('/api/ui/local-session'),cookie=login.headers.get('set-cookie').split(';')[0];
  return {...f,base,post,cookie};
}

test('fork identity and cookie never impersonate or accept the original Hudson session',async t=>{
  const f=await apiFixture(t),health=await(await fetch(f.base+'/health')).json();
  assert.equal(health.instanceId,'harv-hudson');assert.match(f.cookie,/^harv_hudson_session=/);
  const originalCookie=f.cookie.replace('harv_hudson_session=','hudson_session=');
  assert.equal((await fetch(f.base+'/api/dashboard',{headers:{Cookie:originalCookie}})).status,401);
  assert.equal((await fetch(f.base+'/api/dashboard',{headers:{Cookie:f.cookie}})).status,200);
  assert.equal((await f.post('/api/ui/logout',{},f.cookie)).headers.get('set-cookie').startsWith('harv_hudson_session='),true);
});

test('frame embedding does not grant Harv or another website permission to mutate the fork',async t=>{
  const f=await apiFixture(t),parent='http://127.0.0.1:5173';
  const response=await fetch(f.base+'/health',{headers:{Origin:parent}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),parent);
  const csp=(await fetch(f.base+'/')).headers.get('content-security-policy');
  assert.ok(csp.includes(`frame-ancestors ${parent}`));assert.ok(!csp.includes('8788'));
  assert.equal((await f.post('/api/ui/local-session',{},'',parent)).status,403);
  assert.equal((await f.post(`/api/printers/${f.printer.id}/refresh`,{},f.cookie,parent)).status,403);
  assert.equal((await fetch(f.base+'/health',{headers:{Origin:'http://attacker.invalid'}})).status,403);
  assert.equal(f.transport.calls.length,0);
});

test('registration needs exclusive-control confirmation and never imports saved credentials',async t=>{
  const f=await apiFixture(t),input={name:'Harv test',model:'A1',serial:'HARVTEST123',ipAddress:'192.168.1.11',nozzleDiameters:[0.4],accessCode:'synthetic-test'};
  const denied=await f.post('/api/printers',input,f.cookie);
  assert.equal(denied.status,409);assert.equal((await denied.json()).error,'EXCLUSIVE_CONTROL');
  const saved=await f.post('/api/printers',{...input,useSavedAccessCode:true,exclusiveControlConfirmed:true},f.cookie);
  assert.equal(saved.status,409);assert.equal((await saved.json()).error,'MANUAL_CREDENTIAL');
  assert.equal(f.store.printers().length,1);assert.equal(f.transport.calls.length,0);
  assert.equal((await f.post('/api/printers',{...input,exclusiveControlConfirmed:true},f.cookie)).status,201);
  assert.equal(f.store.printers().length,2);assert.equal(f.transport.calls.length,0);
});

test('discovering never imports another installation credentials or auto-registers printers',async t=>{
  const f=await fixture(t),finder=new PrinterDiscovery({...f,interfaces:()=>[],scan:async()=>[],announce:async()=>[{ipAddress:'192.168.1.40',serial:'UNLINKED123',model:'A1'}]});
  const result=await finder.run();
  assert.equal(result.savedCount,0);assert.equal(result.printers[0].hasSavedAccessCode,false);
  assert.equal(f.store.printers().length,1);assert.equal(f.transport.calls.length,0);
});
