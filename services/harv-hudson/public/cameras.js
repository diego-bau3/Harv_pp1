import {t as uiText,ht,locale,translateMessage,languageSelector} from './i18n.js';
const cameraIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 6h4l2-2h4l2 2h4v14H4Z"/><circle cx="12" cy="13" r="4"/></svg>';

export function cameraStage(p,{esc,demo=false}={}) {
  const label=p.model==='X1C'?'X1 Carbon':p.model;
  const message=p.unlinked?uiText('Vincula la impresora para ver su cámara.'):demo?uiText('Las cámaras aparecen al conectar tu taller.'):uiText('Conectando cámara…');
  return ht`<div class="camera-stage" ${!p.unlinked&&!demo?`data-camera-id="${esc(p.id)}"`:''} aria-label="Cámara ${esc(label)}">
    <img class="camera-image" alt="Vista de la cámara ${esc(label)}" hidden>
    <div class="camera-placeholder">${cameraIcon}<span class="camera-message">${message}</span></div>
    <span class="camera-badge"><i></i><span>${p.unlinked?uiText('SIN VINCULAR'):demo?uiText('VISTA DE EJEMPLO'):uiText('CÁMARA LOCAL')}</span></span>
  </div>`;
}

// Keep each camera node (and its latest image) across dashboard refreshes.
// One in-flight request per camera; hidden tabs and other pages stop polling.
export function createCameras() {
  const views=new Map();
  let enabled=false;
  function clearImage(v){if(v.url)URL.revokeObjectURL(v.url);v.url=null;v.node.querySelector('img').removeAttribute('src');}
  function paint(v,message,live=false){
    v.node.classList.toggle('is-live',live);
    v.node.querySelector('img').hidden=!live;
    v.node.querySelector('.camera-placeholder').hidden=live;
    v.node.querySelector('.camera-message').textContent=message;
    v.node.querySelector('.camera-badge span').textContent=live?uiText('EN VIVO'):uiText('CÁMARA LOCAL');
    if(!live)clearImage(v);
  }
  function stop(v){clearTimeout(v.timer);v.abort?.abort();clearImage(v);v.stopped=true;}
  async function poll(id,v) {
    if(v.stopped||!enabled||document.hidden||v.busy)return;
    v.busy=true;v.abort=new AbortController();const timeout=setTimeout(()=>v.abort.abort(),8000);
    let delay=1400;
    try {
      const response=await fetch(`/api/printers/${encodeURIComponent(id)}/camera`,{credentials:'same-origin',cache:'no-store',signal:v.abort.signal});
      if(v.stopped||!enabled||document.hidden)return;
      if(response.ok&&response.headers.get('content-type')?.startsWith('image/jpeg')) {
        const at=Number(response.headers.get('x-hudson-frame-at'));
        if(!Number.isFinite(at)||Date.now()-at>12000)throw new Error('stale');
        const blob=await response.blob();
        if(v.stopped||!enabled||document.hidden)return;
        const previous=v.url;v.url=URL.createObjectURL(blob);
        const img=v.node.querySelector('img');img.src=v.url;
        img.onerror=()=>paint(v,uiText('No se pudo mostrar la imagen. Reintentando…'));
        paint(v,'',true);if(previous)URL.revokeObjectURL(previous);
      } else {
        const data=await response.json();
        if(v.stopped)return;
        paint(v,response.status===401?uiText('Vuelve a abrir Hudson para ver la cámara.'):translateMessage(data.message)||uiText('Cámara sin señal. Reintentando…'));
        delay=data.state==='connecting'?1400:5000;
      }
    } catch {if(!v.stopped)paint(v,uiText('Cámara sin señal. Reintentando…'));delay=5000;}
    finally {clearTimeout(timeout);v.busy=false;if(!v.stopped&&enabled&&!document.hidden)v.timer=setTimeout(()=>poll(id,v),delay);}
  }
  function sync(root,active) {
    enabled=active;
    const nodes=active?[...root.querySelectorAll('[data-camera-id]')]:[],ids=new Set(nodes.map(n=>n.dataset.cameraId));
    for(const [id,v]of views)if(!ids.has(id)){stop(v);views.delete(id);}
    for(const node of nodes){const id=node.dataset.cameraId;let v=views.get(id);
      if(v){if(v.node!==node)node.replaceWith(v.node);}
      else{v={node,url:null,busy:false,stopped:false};views.set(id,v);poll(id,v);}
    }
  }
  document.addEventListener('visibilitychange',()=>{
    for(const [id,v]of views){clearTimeout(v.timer);if(document.hidden){v.abort?.abort();paint(v,uiText('Cámara en pausa mientras esta ventana está oculta.'));}else if(enabled){poll(id,v);}}
  });
  window.addEventListener('pagehide',()=>{for(const v of views.values())stop(v);views.clear();});
  return {sync};
}
