import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CameraFrames,CameraService,cameraPlan,cameraAuth,openCamera } from '../src/cameras.mjs';
import { createApi } from '../src/api.mjs';
import { fixture,fakeVault } from './helpers.mjs';
import { cameraStage } from '../public/cameras.js';

const jpeg=Buffer.from([255,216,255,224,1,2,3,4,255,217]);
const packet=()=>{const h=Buffer.alloc(16);h.writeUInt32LE(jpeg.length);h.writeUInt32LE(1,8);return Buffer.concat([h,jpeg]);};
const tick=()=>new Promise(r=>setImmediate(r));

test('JPEG receiver preserves fragmented headers and coalesced frames, rejecting invalid/oversize data',()=>{
  const frames=[],decoder=new CameraFrames(b=>frames.push(b)),bytes=Buffer.concat([packet(),packet(),packet()]);
  for(const part of [bytes.subarray(0,2),bytes.subarray(2,19),bytes.subarray(19,20),bytes.subarray(20)])decoder.push(part);
  assert.equal(frames.length,3);assert.deepEqual(frames[2],jpeg);
  const huge=Buffer.alloc(16);huge.writeUInt32LE(10*1024*1024);huge.writeUInt32LE(1,8);
  assert.throws(()=>decoder.push(huge),/rejected/);
  const invalid=packet();invalid[16]=0;assert.throws(()=>new CameraFrames(()=>{}).push(invalid),/Invalid/);
  const raw=[];const d=new CameraFrames(b=>raw.push(b),{framed:false});
  d.push(jpeg.subarray(0,1));d.push(Buffer.concat([jpeg.subarray(1),jpeg]));assert.equal(raw.length,2);
  assert.throws(()=>new CameraFrames(()=>{},{framed:false,maxBytes:8}).push(Buffer.concat([jpeg.subarray(0,8),Buffer.alloc(20)])),/large/);
});

test('camera routes use only linked private addresses and respect disabled cameras',()=>{
  const p={model:'X2D',ipAddress:'192.168.1.20'};
  assert.equal(cameraPlan(p,{ipcam:{rtsp_url:'rtsps://attacker.invalid/steal'}}).kind,'rtsps');
  assert.equal(cameraPlan(p,{ipcam:{rtsp_url:'disable'}}).state,'disabled');
  assert.equal(cameraPlan({...p,ipAddress:'8.8.8.8'}).state,'unavailable');
  assert.equal(cameraPlan({...p,model:'A1'}).kind,'jpeg');
  assert.equal(cameraPlan(p,{ipcam:{ipcam_dev:'0'}}).state,'unavailable');
  const auth=cameraAuth('secret-code');assert.equal(auth.length,80);assert.equal(auth.readUInt32LE(4),0x3000);assert.equal(auth.subarray(48,59).toString(),'secret-code');
  assert.throws(()=>cameraAuth('x'.repeat(33)));
});

test('shared camera connection expires without viewers; stale frames and credential changes do not leak prior pictures',async t=>{
  let now=1000,opens=0,closes=0,receiver,secret='one';
  const printer={id:'p',model:'P1S',ipAddress:'192.168.1.20'};
  const cameras=new CameraService({store:{secret:()=>secret,telemetry:()=>({raw:{}})},vault:{unprotect:async x=>x},clock:()=>now,
    open:opts=>{opens++;receiver=opts;return {close(){closes++;}};},idleMs:100,freshMs:50,retryMs:30,startMs:200});t.after(()=>cameras.close());
  assert.equal(cameras.snapshot(printer).state,'connecting');cameras.snapshot(printer);await tick();assert.equal(opens,1);
  receiver.onFrame(jpeg);assert.deepEqual(cameras.snapshot(printer).frame,jpeg);
  now+=51;assert.equal(cameras.snapshot(printer).frame,undefined);
  receiver.onEnd();assert.equal(cameras.snapshot(printer).state,'unavailable');await tick();assert.equal(opens,1);
  now+=31;cameras.snapshot(printer);await tick();assert.equal(opens,2);
  receiver.onFrame(jpeg);secret='two';assert.equal(cameras.snapshot(printer).frame,undefined);await tick();assert.equal(opens,3);
  now+=101;cameras.sweep();assert.equal(cameras.entries.size,0);assert.equal(closes,3);
  receiver.onFrame(jpeg);assert.equal(cameras.entries.size,0);
});

test('closing during credential retrieval prevents launching an orphan camera',async()=>{
  let unlock,opens=0;const cameras=new CameraService({store:{secret:()=>'',telemetry:()=>null},vault:{unprotect:()=>new Promise(r=>unlock=r)},open:()=>{opens++;}});
  cameras.snapshot({id:'p',model:'A1',ipAddress:'192.168.1.20'});cameras.close();unlock('secret');await tick();assert.equal(opens,0);
});

test('RTSPS decoder receives credentials only through stdin and hides its window/logs',()=>{
  let args,options,stdin='';const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.stdin.on('data',x=>stdin+=x);child.kill=()=>{};
  const frames=[];const receiver=openCamera({printer:{ipAddress:'192.168.1.20'},password:"secret'code",plan:{kind:'rtsps'},onFrame:f=>frames.push(f),onEnd:()=>{},ffmpegPath:'local-ffmpeg.exe',spawnProcess:(file,a,o)=>{args=a;options=o;return child;}});
  assert.ok(!args.join(' ').includes('secret'));assert.match(stdin,/secret%27code/);assert.match(stdin,/option rtsp_transport tcp/);assert.equal(options.windowsHide,true);assert.equal(options.stdio[2],'ignore');
  child.stdout.write(jpeg);assert.equal(frames.length,1);receiver.close();
});

test('camera endpoint requires authentication, serves fresh JPEG without cache, and shares the session access policy',async t=>{
  const f=await fixture(t);let opened=0;
  const camera={snapshot:p=>{opened++;assert.equal(p.id,f.printer.id);return {frame:jpeg,at:12345,state:'live'};}};
  const server=createApi({...f,token:'private-token',cameras:camera});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,route=`/api/printers/${f.printer.id}/camera`;
  assert.equal((await fetch(base+route)).status,401);assert.equal(opened,0);
  assert.equal((await fetch(base+route,{headers:{Authorization:'Bearer private-token',Origin:'http://evil.invalid'}})).status,403);assert.equal(opened,0);
  const login=await fetch(base+'/api/ui/local-session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Hudson-UI':'1'},body:'{}'}),cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+route,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-hudson-frame-at'),'12345');assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
  assert.equal((await fetch(base+'/api/printers/unknown/camera',{headers:{Cookie:cookie}})).status,404);
  camera.snapshot=()=>({state:'connecting',message:'Conectando cámara…'});
  const pending=await fetch(base+route,{headers:{Cookie:cookie}});assert.equal(pending.status,202);assert.deepEqual(await pending.json(),{state:'connecting',message:'Conectando cámara…'});
  assert.equal(f.transport.calls.length,0);
});

test('production camera placeholders distinguish unlinked and demo printers without starting streams',()=>{
  const esc=s=>String(s).replaceAll('"','&quot;');
  assert.match(cameraStage({id:'p',model:'A1'},{esc}),/data-camera-id="p"/);
  assert.doesNotMatch(cameraStage({id:'p',model:'A1',unlinked:true},{esc}),/data-camera-id/);
  assert.doesNotMatch(cameraStage({id:'p',model:'A1'},{esc,demo:true}),/data-camera-id/);
});
