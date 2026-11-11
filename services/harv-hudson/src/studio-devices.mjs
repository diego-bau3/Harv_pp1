import { readFile,stat } from 'node:fs/promises';
import path from 'node:path';

export function parseStudioCredentials(text) {
  const data=JSON.parse(text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>!/^\s*#/.test(line)).join('\n'));
  const codes=new Map();
  for(const field of ['access_code','user_access_code']) {
    const values=data?.[field];if(!values||typeof values!=='object'||Array.isArray(values))continue;
    for(const [serial,code]of Object.entries(values))if(/^[A-Za-z0-9_-]{6,40}$/.test(serial)&&typeof code==='string'&&code.length>=6&&code.length<=64)codes.set(serial,code);
  }
  return codes;
}
export async function readStudioCredentials({dataDir,appData=process.env.APPDATA}={}) {
  const files=[dataDir&&path.join(dataDir,'studio-profile','BambuStudio.conf'),appData&&path.join(appData,'BambuStudio','BambuStudio.conf')].filter(Boolean);
  const codes=new Map();
  for(const file of files)try {
    if((await stat(file)).size>5*1024*1024)continue;
    for(const [serial,code]of parseStudioCredentials(await readFile(file,'utf8')))codes.set(serial,code);
  } catch { /* A missing or mid-write Studio profile does not prevent LAN discovery. */ }
  return codes;
}
