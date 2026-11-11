import { discover,lanInterfaces,scanTargets,scanMqttHosts,isLanIp } from './discovery.mjs';

export class PrinterDiscovery {
  constructor({store,config,announce=discover,interfaces=lanInterfaces,scan=scanMqttHosts,credentials=async()=>new Map(),cacheMs=30000}) {
    Object.assign(this,{store,config,announce,interfaces,scan,credentials,cacheMs});this.pending=null;this.result=null;this.error=null;
  }
  status(){return {running:!!this.pending,result:this.result,error:this.error};}
  run({force=false}={}) {
    if(this.pending)return this.pending;
    if(!force&&this.result&&Date.now()-Date.parse(this.result.scannedAt)<this.cacheMs)return Promise.resolve(this.result);
    this.error=null;
    this.pending=this.perform().then(result=>this.result=result).catch(error=>{this.error='No se pudo completar la búsqueda. Intenta de nuevo.';throw error;}).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async perform() {
    const networks=this.interfaces(),{targets,limited}=scanTargets(networks),warnings=[];
    const [announced,open,codes]=await Promise.all([
      this.announce({interfaces:networks,onDiagnostic:d=>warnings.push(`No se pudo escuchar el puerto de descubrimiento ${d.port} (${d.code}).`)}),
      this.scan(targets),this.credentials(),
    ]);
    const linked=this.store.printers(),printers=[],seen=new Set();
    for(const p of announced) {
      if(!p||!isLanIp(p.ipAddress)||p.ipAddress.startsWith('127.')||!/^[A-Za-z0-9_-]{6,40}$/.test(p.serial||''))continue;
      const key=`${p.serial}@${p.ipAddress}`;if(seen.has(key))continue;seen.add(key);
      // Serialize only public fields; no access codes or arbitrary discovery payloads.
      printers.push({serial:p.serial,ipAddress:p.ipAddress,name:String(p.name||p.model||'Bambu Lab').slice(0,80),model:p.model||'',source:'bambu-ssdp',
        hasSavedAccessCode:codes.has(p.serial),linkedPrinterId:linked.find(item=>item.serial===p.serial)?.id||null,
        supported:['P1S','A1','X1C','X2D'].includes(p.model)});
    }
    const identities=new Set(printers.map(p=>p.ipAddress));
    const unidentified=[...new Set(open)].filter(ip=>targets.includes(ip)&&!identities.has(ip)).map(ipAddress=>({ipAddress,source:'mqtt-port',name:'Equipo por identificar'}));
    return {printers,unidentified,networks:networks.map(({name,address,network})=>({name,address,network})),scannedHosts:targets.length,limited,savedCount:codes.size,warnings,scannedAt:new Date().toISOString()};
  }
}
