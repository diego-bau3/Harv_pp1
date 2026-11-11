import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile,stat } from 'node:fs/promises';
import { fixture,writeArchive } from './helpers.mjs';
import { ProductionService } from '../src/production.mjs';
import { Store } from '../src/store.mjs';
import { createApi } from '../src/api.mjs';

async function setup(t) {
  const f=await fixture(t),production=new ProductionService(f);t.after(()=>production.close());
  const source=path.join(f.dir,'first.gcode.3mf'),second=path.join(f.dir,'second.gcode.3mf');
  await writeArchive(source);await writeArchive(second,{extra:[['Metadata/note.txt','second fixture']]});
  f.transport.uploadBytes=(await stat(source)).size;
  const one=await production.importFile(source,'Primero'),two=await production.importFile(second,'Segundo');
  const input={libraryId:one.id,plate:1,piecesPerPlate:1,settings:{useAms:true,amsMapping:[0]}};
  const job=production.add(f.printer.id,input,'add-for-delete').jobs[0];
  return {...f,production,source,one,two,input,job};
}

test('bulk library removal persists, preserves queued files and history, and is idempotent',async t=>{
  const f=await setup(t),before=f.store.jobs(f.printer.id),ids=[f.one.id,f.two.id];
  const result=f.production.deleteLibrary({ids:[...ids,f.one.id]},'delete-two-files');
  assert.deepEqual(new Set(result.deletedIds),new Set(ids));
  assert.deepEqual(f.store.library(),[]);
  assert.deepEqual(f.store.jobs(f.printer.id),before);
  assert.deepEqual(f.store.jobLibrary().map(f=>f.id),[f.one.id]);
  assert.deepEqual(await readFile(f.production.file(f.one.id)),await readFile(f.source));
  assert.equal(f.transport.calls.length,0);
  assert.deepEqual(f.production.deleteLibrary({ids:ids.reverse()},'delete-two-files'),result);
  assert.equal(f.store.events().filter(e=>e.kind==='library-deleted').length,2);
  const reopened=new Store(f.dir);
  try {assert.deepEqual(reopened.library(),[]);assert.ok(reopened.libraryItem(f.one.id).deletedAt);assert.deepEqual(reopened.job(f.job.id),f.job);}
  finally {reopened.close();}
  assert.throws(()=>f.production.add(f.printer.id,f.input,'add-removed-file'),{code:'LIBRARY_DELETED'});
  // Only FakeTransport is used: the already-queued job remains dispatchable.
  const dispatched=await f.production.dispatch(f.printer.id,{jobId:f.job.id,bedCleared:true,setupConfirmed:true},'dispatch-retained-file');
  assert.equal(dispatched.job.libraryId,f.one.id);assert.equal(f.transport.calls.length,1);
});

test('invalid batch rolls back every removal; validation and idempotency keys protect retries',async t=>{
  const f=await setup(t);
  for(const ids of [[],null,['../outside'],Array(501).fill(f.one.id)])
    assert.throws(()=>f.production.deleteLibrary({ids},'invalid-delete'),{code:'LIBRARY_IDS'});
  assert.throws(()=>f.production.deleteLibrary({ids:[f.one.id]}),{code:'REQUEST_KEY'});
  assert.throws(()=>f.production.deleteLibrary({ids:[f.one.id,'f'.repeat(64)]},'missing-library-id'),{code:'NOT_FOUND'});
  assert.equal(f.store.library().length,2);assert.equal(f.store.events().filter(e=>e.kind==='library-deleted').length,0);
  f.production.deleteLibrary({ids:[f.one.id]},'same-delete-key');
  assert.throws(()=>f.production.deleteLibrary({ids:[f.two.id]},'same-delete-key'),{code:'KEY_REUSED'});
  assert.equal(f.store.library()[0].id,f.two.id);
});

test('reimport restores a removed file without duplication or changes to its queued jobs',async t=>{
  const f=await setup(t),input={ids:[f.one.id]},key='remove-then-restore';
  f.production.deleteLibrary(input,key);
  const restored=await f.production.importFile(f.source,'New name');
  assert.equal(restored.id,f.one.id);assert.equal(restored.deletedAt,undefined);
  assert.equal(f.store.library().length,2);assert.deepEqual(f.store.jobLibrary(),[]);
  assert.deepEqual(f.store.job(f.job.id),f.job);
  // A delayed retry of the old delete must not hide a newly restored file.
  f.production.deleteLibrary(input,key);assert.equal(f.store.library().length,2);
});

test('library deletion API requires authorization and same-origin UI requests; dashboard keeps referenced metadata',async t=>{
  const f=await setup(t),server=createApi({...f,token:'test-library-token',discovery:async()=>[]});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,body=JSON.stringify({ids:[f.one.id]});
  const remove=headers=>fetch(base+'/api/library/delete',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'http-library-delete',...headers},body});
  assert.equal((await remove({})).status,401);
  const login=await fetch(base+'/api/ui/local-session',{method:'POST',headers:{Origin:base,'X-Hudson-UI':'1','Content-Type':'application/json'},body:'{}'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await remove({Cookie:cookie})).status,403);
  assert.equal((await remove({Cookie:cookie,Origin:'http://attacker.invalid','X-Hudson-UI':'1'})).status,403);
  assert.equal(f.store.library().length,2);
  const response=await remove({Cookie:cookie,Origin:base,'X-Hudson-UI':'1'});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).deletedIds,[f.one.id]);
  const dashboard=await(await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(dashboard.library.map(f=>f.id),[f.two.id]);
  assert.deepEqual(dashboard.jobFiles.map(f=>f.id),[f.one.id]);
  assert.equal(dashboard.queues[0].pending[0].libraryId,f.one.id);
  assert.equal((await remove({Authorization:'Bearer test-library-token'})).status,200);
  assert.equal(f.transport.calls.length,0);
});
