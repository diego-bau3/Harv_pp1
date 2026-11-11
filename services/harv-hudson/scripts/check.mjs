import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const directory of ['src','scripts','test','public']) {
  for(const name of await readdir(directory)) if(/\.m?js$/.test(name)) {
    const result=spawnSync(process.execPath,['--check',`${directory}/${name}`],{stdio:'inherit'});
    if(result.status!==0)process.exit(result.status || 1);
  }
}
console.log('Sintaxis verificada.');
