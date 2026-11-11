import path from 'node:path';
import { lstat,mkdir,readFile,writeFile,readdir,realpath } from 'node:fs/promises';

export async function prepareDataDirectory(config) {
  const directory=path.resolve(config.dataDir);
  await mkdir(directory,{recursive:true});
  const info=await lstat(directory);
  if(info.isSymbolicLink() || path.resolve(await realpath(directory)).toLowerCase()!==directory.toLowerCase()) throw new Error('Harv Hudson requiere una carpeta propia, sin enlaces a otra instalacion.');
  const marker=path.join(directory,'installation.json');
  let existing;
  try {existing=JSON.parse(await readFile(marker,'utf8'));}
  catch(error) {
    if(error.code!=='ENOENT') throw error;
    if((await readdir(directory)).length) throw new Error('La carpeta contiene datos ajenos. No se iniciara Harv Hudson.');
    await writeFile(marker,JSON.stringify({instanceId:'harv-hudson',schema:1},null,2),{flag:'wx'});
    return;
  }
  if(existing.instanceId!=='harv-hudson' || existing.schema!==1) throw new Error('La carpeta no pertenece a Harv Hudson.');
}
