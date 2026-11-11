import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, BarChart3, BookOpen, Boxes, ClipboardList, Factory, History, Loader2, Printer, RefreshCw, Settings2, Unplug } from "lucide-react";
import type { Product } from "../../sales/types";
import { FabricationScreen } from "./FabricationScreen";
import "../hudson.css";

const sections = [
  { id: "production", label: "Impresoras y colas", icon: Printer },
  { id: "library", label: "Biblioteca", icon: BookOpen },
  { id: "inventory", label: "Filamento", icon: Boxes },
  { id: "ipad", label: "Recoleccion", icon: ClipboardList },
  { id: "history", label: "Historial", icon: History },
  { id: "statistics", label: "Estadisticas", icon: BarChart3 },
  { id: "settings", label: "Ajustes", icon: Settings2 }
] as const;

function tabKeys(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
}

function serviceUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const url = new URL(env?.VITE_HARV_HUDSON_URL || "http://127.0.0.1:8789");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || ["8787", "8788"].includes(url.port) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("La direccion de Hudson de Harv debe ser local y exclusiva.");
  }
  // Keep iframe cookies same-site when Harv is opened as localhost.
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) url.hostname = window.location.hostname;
  return url.origin;
}

function HudsonPanel() {
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("production");
  const [status, setStatus] = useState<"checking" | "ready" | "offline" | "wrong-service">("checking");
  const [retry, setRetry] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [url] = useState(() => { try { return serviceUrl(); } catch { return ""; } });

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== url || event.source !== frame.current?.contentWindow || event.data?.type !== "harv-hudson:navigation") return;
      const next = sections.find(item => item.id === event.data.page);
      if (next) setSection(next.id);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [url]);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      if (!url) { setStatus("wrong-service"); return; }
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 3500);
      try {
        const response = await fetch(`${url}/health`, { signal: active.signal, cache: "no-store", credentials: "omit" });
        const health = await response.json();
        if (!disposed) setStatus(response.ok && health.ok && health.instanceId === "harv-hudson" && health.version === "0.1.0" ? "ready" : "wrong-service");
      } catch { if (!disposed) setStatus("offline"); }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(check, 5000); }
    }
    void check();
    return () => { disposed = true; active?.abort(); clearTimeout(timer); };
  }, [retry, url]);

  return <section className="harv-hudson" aria-label="Hudson de Harv">
    <div className="harv-hudson-toolbar">
      <div className="harv-hudson-tabs" role="tablist" aria-label="Secciones de Hudson" onKeyDown={tabKeys}>
        {sections.map(({ id, label, icon: Icon }) => <button key={id} id={`hudson-tab-${id}`} type="button" role="tab" aria-selected={section === id} aria-controls="hudson-panel" tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)}><Icon size={16} /><span>{label}</span></button>)}
      </div>
      <span className={`harv-hudson-status ${status}`} role="status"><i />{status === "ready" ? "Conectado" : status === "checking" ? "Conectando" : "Sin conexion"}</span>
    </div>
    <div id="hudson-panel" role="tabpanel" aria-labelledby={`hudson-tab-${section}`} className="harv-hudson-surface">
      {status === "ready" ? <>
        {!frameLoaded && <div className="harv-hudson-loading" role="status"><Loader2 size={22} />Cargando Hudson</div>}
        <iframe ref={frame} key={retry} src={`${url}/?shell=1&harv=1&parentOrigin=${encodeURIComponent(window.location.origin)}#${section}`} title="Hudson integrado en Harv" className="harv-hudson-frame" onLoad={() => setFrameLoaded(true)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups" referrerPolicy="no-referrer" />
      </> : <div className="harv-hudson-unavailable">
        {status === "checking" ? <Loader2 size={30} /> : <Unplug size={30} />}
        <h2>{status === "checking" ? "Conectando con Hudson" : status === "wrong-service" ? "Servicio incompatible" : "Hudson de Harv no esta disponible"}</h2>
        {status !== "checking" && <><p>{status === "wrong-service" ? "La direccion no corresponde a esta instalacion de Hudson." : "No se pudo conectar con el servicio local de Harv."}</p><button className="secondary-button" type="button" onClick={() => { setFrameLoaded(false); setStatus("checking"); setRetry(value => value + 1); }}><RefreshCw size={16} />Reintentar</button></>}
      </div>}
    </div>
  </section>;
}

export function FabricationWorkspace({ products, onBack }: { products: Product[]; onBack: () => void }) {
  const [view, setView] = useState<"hudson" | "plan">("hudson");
  return <div className="fabrication-workspace">
    <header className="screen-header"><button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles"><ArrowLeft size={22} /></button><div className="screen-title"><span className="screen-icon fabrication-screen-icon"><Factory size={22} /></span><h1>Fabricacion</h1></div></header>
    <div className="fabrication-workspace-tabs" role="tablist" aria-label="Fabricacion" onKeyDown={tabKeys}>
      <button id="fabrication-tab-hudson" type="button" role="tab" tabIndex={view === "hudson" ? 0 : -1} aria-selected={view === "hudson"} aria-controls="fabrication-workspace-panel" onClick={() => setView("hudson")}><Printer size={18} />Hudson</button>
      <button id="fabrication-tab-plan" type="button" role="tab" tabIndex={view === "plan" ? 0 : -1} aria-selected={view === "plan"} aria-controls="fabrication-workspace-panel" onClick={() => setView("plan")}><ClipboardList size={18} />Plan de fabricacion</button>
    </div>
    <div id="fabrication-workspace-panel" role="tabpanel" aria-labelledby={`fabrication-tab-${view}`}>
      {view === "hudson" ? <HudsonPanel /> : <FabricationScreen products={products} onBack={onBack} embedded />}
    </div>
  </div>;
}
