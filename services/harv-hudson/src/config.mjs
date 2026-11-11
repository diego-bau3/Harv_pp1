import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function configFromEnv(env = process.env) {
  const port = Number(env.HARV_HUDSON_PORT || 8789);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [8787,8788].includes(port)) throw new Error('HARV_HUDSON_PORT invalido o reservado para otro servicio.');
  const frameOrigins=(env.HARV_HUDSON_FRAME_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value=>value.trim());
  for(const origin of frameOrigins) {
    const url=new URL(origin);
    if(url.origin!==origin || url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || !url.port || [8787,8788,port].includes(Number(url.port))) throw new Error('Origen de Harv no permitido. Usa una direccion local y un puerto exclusivo.');
  }
  // Never inherit HUDSON_* variables or share the original installation's data.
  return { host: '127.0.0.1', port, instanceId:'harv-hudson', frameOrigins,
    dataDir: path.join(projectDir, 'data'), requireExclusiveControl:true,
    staleMs: 75_000, commandTimeoutMs: 30_000, maxUploadBytes: 512 * 1024 * 1024,
    allowedOrigin:'', mqttDisabled: env.HARV_HUDSON_DISABLE_MQTT === '1' };
}
