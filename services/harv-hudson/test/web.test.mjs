import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createApi } from '../src/api.mjs';
import { WebUI } from '../src/web.mjs';

async function webFixture(t) {
  const f=await fixture(t),server=createApi({...f,token:'private-test-token'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body={},cookie='',headers={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Hudson-UI':'1','Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(body)});
  const login=await post('/api/ui/local-session'),cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal(login.status,200);
  return {...f,server,base,post,cookie};
}

test('dashboard assets load publicly but private data requires a session; responses omit credentials',async t=>{
  const {base,cookie}=await webFixture(t);
  for(const path of ['/','/app.js','/demo.js','/styles.css','/icon.svg','/i18n.js','/translations.js']) {
    const response=await fetch(base+path);assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors http:\/\/127\.0\.0\.1:5173 http:\/\/localhost:5173;/);
    assert.ok(!(await response.text()).includes('private-test-token'));
  }
  assert.equal((await fetch(base+'/api/dashboard')).status,401);
  const response=await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}}),body=await response.text();
  assert.equal(response.status,200);assert.equal(JSON.parse(body).printers.length,1);
  assert.ok(!body.includes('test-code'));assert.ok(!body.includes('private-test-token'));
  assert.equal((await fetch(base+'/api/ui/session',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(base+'/../package.json')).status,401);
});

test('UI mutations enforce same origin and custom header while CLI bearer access remains supported',async t=>{
  const {base,post,cookie,printer,transport}=await webFixture(t),route=`/api/printers/${printer.id}/refresh`;
  assert.equal((await post(route,{},cookie,{Origin:'http://attacker.invalid'})).status,403);
  assert.equal((await post(route,{},cookie,{'X-Hudson-UI':''})).status,403);
  assert.equal((await post(route,{},cookie,{Origin:''})).status,403);
  assert.equal((await post('/api/ui/local-session',{},'',{Origin:'http://attacker.invalid'})).status,403);
  assert.equal((await post(route,{},cookie)).status,202);
  assert.equal((await fetch(base+'/api/printers',{headers:{Authorization:'Bearer private-test-token'}})).status,200);
  assert.equal(transport.calls.length,0);
});

test('pairing uses one-time codes, stores only session hashes and logout revokes access',async t=>{
  const {base,post,cookie,store}=await webFixture(t);
  assert.equal((await post('/api/ui/pair-code')).status,403);
  const {code}=await(await post('/api/ui/pair-code',{},cookie)).json();assert.match(code,/^\d{8}$/);
  const paired=await post('/api/ui/pair',{code}),newCookie=paired.headers.get('set-cookie');
  assert.equal(paired.status,200);assert.match(newCookie,/HttpOnly; SameSite=Strict/);
  assert.ok(!store.getSetting('ui-sessions').includes(newCookie.split(';')[0].slice(15)));
  assert.equal((await post('/api/ui/pair',{code})).status,403);
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:newCookie.split(';')[0]}})).status,200);
  assert.equal((await post('/api/ui/logout',{},newCookie.split(';')[0])).status,200);
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:newCookie.split(';')[0]}})).status,401);
});

test('pairing rejects repeated guesses and expired codes; remote clients cannot bootstrap locally',async t=>{
  const {post,store,config}=await webFixture(t);
  for(let i=0;i<5;i++)assert.equal((await post('/api/ui/pair',{code:'00000000'})).status,403);
  assert.equal((await post('/api/ui/pair',{code:'00000000'})).status,429);
  const web=new WebUI({store,config});
  const request={method:'POST',headers:{host:'127.0.0.1:8788',origin:'http://127.0.0.1:8788','x-hudson-ui':'1'},socket:{remoteAddress:'192.168.1.25',localPort:8788}};
  await assert.rejects(web.handle({request,response:{},url:new URL('http://localhost/api/ui/local-session'),jsonBody:async()=>({})}),{code:'LOCAL_ONLY'});
  web.pair={expiresAt:Date.now()-1,failures:0,hash:'expired'};
  await assert.rejects(web.handle({request,response:{},url:new URL('http://localhost/api/ui/pair'),jsonBody:async()=>({code:'12345678'})}),{code:'PAIR_CODE'});
  assert.throws(()=>web.origin({...request,headers:{host:'attacker.invalid:8788'}}),{code:'HOST'});
  assert.throws(()=>web.origin({...request,headers:{host:'127.0.0.1:80'}}),{code:'HOST'});
});
