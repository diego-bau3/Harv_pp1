import crypto from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { projectDir } from './config.mjs';
import { requireThat } from './errors.mjs';

const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const cookieName='harv_hudson_session';
const localAddress=s=>['127.0.0.1','::1'].includes(String(s||'').replace('::ffff:',''));
const assets=new Map([['/','index.html'],['/ipad','index.html'],['/ipad.js','ipad.js'],['/ipad-state.js','ipad-state.js'],['/ipad.css','ipad.css'],['/index.html','index.html'],['/app.js','app.js'],['/cameras.js','cameras.js'],['/demo.js','demo.js'],['/discovery.js','discovery.js'],['/styles.css','styles.css'],['/icon.svg','icon.svg']]);
assets.set('/statistics.js','statistics.js');
assets.set('/statistics.css','statistics.css');
assets.set('/ipad-inventory.js','ipad-inventory.js');
assets.set('/spool-labels.js','spool-labels.js');
assets.set('/filament-access.js','filament-access.js');
assets.set('/planned-filament.js','planned-filament.js');
assets.set('/harv.css','harv.css');
assets.set('/i18n.js','i18n.js');
assets.set('/translations.js','translations.js');
const addresses=()=>Object.values(networkInterfaces()).flat().filter(n=>n?.family==='IPv4'&&!n.internal).map(n=>n.address);
export class WebUI {
  constructor({store,config}) {Object.assign(this,{store,config});this.pair=null;this.attempts=new Map();}
  origin(request) {
    let url;try {url=new URL(`http://${request.headers.host}`);}catch {requireThat(false,'HOST','Dirección no permitida.',403);}
    const allowed=new Set(['localhost','127.0.0.1','[::1]',...addresses()]);
    requireThat(allowed.has(url.hostname)&&Number(url.port||80)===request.socket.localPort,'HOST','Dirección no permitida.',403);
    return url.origin;
  }
  local(request){return localAddress(request.socket.remoteAddress);}
  sessions(){return JSON.parse(this.store.getSetting('ui-sessions')||'[]').filter(s=>s.expiresAt>Date.now());}
  session(request) {
    const raw=String(request.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    if(!raw||raw.length>100)return null;
    return this.sessions().find(s=>s.hash===digest(raw))||null;
  }
  issue(response,local) {
    const raw=crypto.randomBytes(32).toString('base64url'),maxAge=local?43200:604800;
    const session={hash:digest(raw),expiresAt:Date.now()+maxAge*1000,createdAt:Date.now()};
    this.store.setSetting('ui-sessions',JSON.stringify([...this.sessions().slice(-31),session]));
    response.setHeader('Set-Cookie',`${cookieName}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  }
  network(request) {return {local:this.local(request),lanEnabled:this.config.host==='0.0.0.0',urls:addresses().map(ip=>`http://${ip}:${request.socket.localPort}`)};}
  requireLocal(request) {requireThat(this.local(request)&&this.session(request),'LOCAL_ONLY','Esta acción se realiza desde la PC de Hudson.',403);}
  async handle({request,response,url,send,jsonBody,changeLan}) {
    if(assets.has(url.pathname)&&['GET','HEAD'].includes(request.method)) {
      const name=assets.get(url.pathname),file=await readFile(path.join(projectDir,'public',name));
      response.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8');
      const parents=this.config.frameOrigins?.length?this.config.frameOrigins.join(' '):"'none'";
      response.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors ${parents}; base-uri 'none'; form-action 'self'`);
      response.setHeader('Cache-Control','no-cache');
      response.setHeader('Referrer-Policy','no-referrer');response.end(request.method==='HEAD'?undefined:file);return true;
    }
    if(url.pathname==='/api/ui/session'&&request.method==='GET') {send(200,{authenticated:!!this.session(request),...this.network(request)});return true;}
    if(!url.pathname.startsWith('/api/ui/'))return false;
    requireThat(request.method==='POST','NOT_FOUND','Ruta no encontrada.',404);
    requireThat(request.headers.origin===this.origin(request)&&request.headers['x-hudson-ui']==='1','ORIGIN','Abre Hudson desde su dirección local.',403);
    const input=await jsonBody(request);
    if(url.pathname==='/api/ui/local-session') {
      requireThat(this.local(request),'LOCAL_ONLY','Usa el código de enlace que aparece en la PC.',403);
      this.issue(response,true);send(200,{authenticated:true,...this.network(request)});return true;
    }
    if(url.pathname==='/api/ui/pair-code') {
      this.requireLocal(request);const code=String(crypto.randomInt(10000000,100000000));
      this.pair={hash:digest(code),expiresAt:Date.now()+300000,failures:0};
      send(200,{code,expiresAt:this.pair.expiresAt,...this.network(request)});return true;
    }
    if(url.pathname==='/api/ui/pair') {
      const address=request.socket.remoteAddress,bucket=this.attempts.get(address);
      const record=bucket&&bucket.until>Date.now()?bucket:{count:0,until:Date.now()+300000};
      requireThat(record.count<5,'PAIR_LIMIT','Espera cinco minutos antes de volver a intentar.',429);
      record.count++;this.attempts.set(address,record);
      for(const [key,value]of this.attempts)if(value.until<Date.now())this.attempts.delete(key);
      const code=String(input.code||'').replace(/[\s-]/g,'');
      const valid=this.pair&&this.pair.expiresAt>Date.now()&&this.pair.failures<20&&/^\d{8}$/.test(code)&&digest(code)===this.pair.hash;
      if(!valid){if(this.pair)this.pair.failures++;requireThat(false,'PAIR_CODE','El código no es válido o ya venció.',403);}
      this.pair=null;this.issue(response,false);send(200,{authenticated:true,...this.network(request)});return true;
    }
    if(url.pathname==='/api/ui/logout') {
      const current=this.session(request);if(current)this.store.setSetting('ui-sessions',JSON.stringify(this.sessions().filter(s=>s.hash!==current.hash)));
      response.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);send(200,{ok:true});return true;
    }
    if(url.pathname==='/api/ui/lan') {
      this.requireLocal(request);requireThat(typeof input.enabled==='boolean','NETWORK','Indica si quieres habilitar la red local.');
      this.store.setSetting('ui-lan-enabled',String(input.enabled));send(200,{ok:true,reconnecting:true});
      setTimeout(()=>changeLan(input.enabled).catch(()=>this.store.event(null,'ui-network-error')),150).unref();return true;
    }
    return false;
  }
}
