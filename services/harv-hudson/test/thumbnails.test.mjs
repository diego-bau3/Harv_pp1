import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,unlink,readdir,stat} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fixture,writeArchive} from './helpers.mjs';
import {ProductionService} from '../src/production.mjs';
import {createApi} from '../src/api.mjs';
import {readPlateThumbnail,validThumbnail,PlateThumbnails} from '../src/thumbnails.mjs';

function chunk(type,data) {
  const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(data.length+12);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
function png(red) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,red,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
const one=png(0),four=png(255);
async function setup(t,extra=[]) {
  const f=await fixture(t),production=new ProductionService(f);t.after(()=>production.close());
  const source=path.join(f.dir,'plate-four.3mf');
  await writeArchive(source,{sliced:false,xml:'<config><plate><metadata key="index" value="4"/><filament id="1" type="PLA" used_g="10"/></plate></config>',
    extra:[['Metadata/plate_4.gcode','; fixture; NEVER PRINT'],['Metadata/plate_1.png',one],...extra]});
  const item=await production.importFile(source,'Only plate 4');
  return {...f,production,item,source};
}

test('exact plate thumbnails ignore other project plates and use only matching small previews as fallback',async t=>{
  const f=await setup(t,[['Metadata/plate_4.png',four]]);
  assert.deepEqual(await readPlateThumbnail(f.source,4),four);
  assert.equal(await readPlateThumbnail(f.source,1),null,'orphan image has no sliced plate');
  const noImage=path.join(f.dir,'no-image.3mf');
  await writeArchive(noImage,{extra:[['Metadata/plate_4.png',four]]});
  assert.equal(await readPlateThumbnail(noImage,1),null,'never substitute another plate');
  const small=path.join(f.dir,'small.3mf');
  await writeArchive(small,{extra:[['Metadata/plate_1.png','invalid'],['Metadata/plate_1_small.png',one]]});
  assert.deepEqual(await readPlateThumbnail(small,1),one);
  assert.equal(await readPlateThumbnail(path.join(f.dir,'missing'),4),null);
});

test('malformed and oversized PNGs are unavailable without breaking import or production',async t=>{
  const f=await setup(t,[['Metadata/plate_4.png','<svg onload="bad"/>']]);
  assert.equal(await readPlateThumbnail(f.source,4),null);
  assert.equal(validThumbnail(Buffer.alloc(2*1024*1024+1)),false);
  const bigDimensions=Buffer.from(four);bigDimensions.writeUInt32BE(5000,16);
  assert.equal(validThumbnail(bigDimensions),false);
  assert.equal(validThumbnail(four),true);
  const archive=path.join(f.dir,'large.3mf');
  await writeArchive(archive,{extra:[['Metadata/plate_1.png',Buffer.alloc(2*1024*1024+1)]]});
  assert.equal(await readPlateThumbnail(archive,1),null);
  await assert.rejects(readPlateThumbnail(f.source,-1),{code:'PLATE'});
});

test('derived local cache serves historical and new files without altering originals, queue or inventory',async t=>{
  const f=await setup(t,[['Metadata/plate_4.png',four]]),cache=new PlateThumbnails(f);
  const job=f.production.add(f.printer.id,{libraryId:f.item.id,plate:4,piecesPerPlate:1,settings:{useAms:true,amsMapping:[0]}},'thumbnail-job').jobs[0];
  f.production.deleteLibrary({ids:[f.item.id]},'hide-preview-file');
  const before=JSON.stringify({jobs:f.store.jobs(f.printer.id),spools:f.store.spools(),events:f.store.events(),library:f.store.libraryItem(f.item.id)});
  const original=await readFile(f.production.file(f.item.id));
  const results=await Promise.all([cache.get(f.item.id,4),cache.get(f.item.id,4)]);
  for(const image of results)assert.deepEqual(image,four);
  assert.equal(JSON.stringify({jobs:f.store.jobs(f.printer.id),spools:f.store.spools(),events:f.store.events(),library:f.store.libraryItem(f.item.id)}),before);
  assert.deepEqual(await readFile(f.production.file(f.item.id)),original);
  assert.equal(f.store.job(job.id).state,'queued');assert.equal(f.transport.calls.length,0);
  const files=await readdir(path.join(f.dir,'thumbnails'));assert.equal(files.length,1);
  const cached=path.join(f.dir,'thumbnails',files[0]);assert.equal((await stat(cached)).size,four.length);
  await writeFile(cached,'broken cache');assert.deepEqual(await cache.get(f.item.id,4),four);
  await unlink(f.production.file(f.item.id));assert.deepEqual(await new PlateThumbnails(f).get(f.item.id,4),four);
  for(const [id,plate]of [['../outside',4],[f.item.id,1],[f.item.id,NaN],['f'.repeat(64),4]])await assert.rejects(cache.get(id,plate),{code:'NOT_FOUND'});
});

test('thumbnail endpoint requires the existing session and returns only the requested registered plate',async t=>{
  const f=await setup(t,[['Metadata/plate_4.png',four]]),server=createApi({...f,token:'thumbnail-test',discovery:async()=>[]});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,route=`/api/library/${f.item.id}/plates/4/thumbnail`;
  assert.equal((await fetch(base+route)).status,401);
  const login=await fetch(base+'/api/ui/local-session',{method:'POST',headers:{Origin:base,'X-Hudson-UI':'1','Content-Type':'application/json'},body:'{}'});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const response=await fetch(base+route,{headers});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.match(response.headers.get('cache-control'),/^private/);assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),four);
  assert.equal((await fetch(base+route.replace('/4/','/1/'),{headers})).status,404);
  assert.equal((await fetch(base+route,{headers:{...headers,Origin:'http://evil.invalid'}})).status,403);
  f.production.deleteLibrary({ids:[f.item.id]},'api-preview-hidden');
  assert.equal((await fetch(base+route,{headers})).status,200);
  assert.equal(f.transport.calls.length,0);
});
