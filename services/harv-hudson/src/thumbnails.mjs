import path from 'node:path';
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import yauzl from 'yauzl';
import {requireThat} from './errors.mjs';

const MAX_BYTES=2*1024*1024;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
export function validThumbnail(buffer) {
  if(!buffer||buffer.length<45||buffer.length>MAX_BYTES||!buffer.subarray(0,8).equals(signature))return false;
  if(buffer.readUInt32BE(8)!==13||buffer.toString('ascii',12,16)!=='IHDR')return false;
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  return width>0&&height>0&&width<=4096&&height<=4096&&buffer.toString('ascii',buffer.length-8,buffer.length-4)==='IEND';
}

// Only the selected plate's standard PNGs are eligible. Other plate previews
// can remain in single-plate exports; never use plate 1 as a general fallback.
export async function readPlateThumbnail(file,plate) {
  requireThat(Number.isSafeInteger(plate)&&plate>0,'PLATE','Placa inválida.',404);
  const names=[`Metadata/plate_${plate}.png`,`Metadata/plate_${plate}_small.png`];
  return new Promise(resolve=>{
    yauzl.open(file,{lazyEntries:true},(error,zip)=>{
      if(error){resolve(null);return;}
      let settled=false,count=0,hasGcode=false;const images=new Map(),seen=new Set();
      const finish=value=>{if(settled)return;settled=true;zip.close();resolve(value);};
      zip.on('error',()=>finish(null));
      zip.on('end',()=>finish(hasGcode?(images.get(names[0])||images.get(names[1])||null):null));
      zip.on('entry',entry=>{
        if(++count>20000||(entry.generalPurposeBitFlag&1))return finish(null);
        if(entry.fileName===`Metadata/plate_${plate}.gcode`&&entry.uncompressedSize>0)hasGcode=true;
        if(!names.includes(entry.fileName)){zip.readEntry();return;}
        if(seen.has(entry.fileName))return finish(null);
        seen.add(entry.fileName);
        if(entry.uncompressedSize>MAX_BYTES){zip.readEntry();return;}
        zip.openReadStream(entry,(err,stream)=>{
          if(err)return finish(null);
          const chunks=[];let size=0;
          stream.on('error',()=>finish(null));
          stream.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){stream.destroy();finish(null);}else chunks.push(chunk);});
          stream.on('end',()=>{if(settled)return;const image=Buffer.concat(chunks);if(validThumbnail(image))images.set(entry.fileName,image);zip.readEntry();});
        });
      });
      zip.readEntry();
    });
  });
}

export class PlateThumbnails {
  constructor({store,config}) {this.store=store;this.directory=path.join(config.dataDir,'thumbnails');this.library=path.join(config.dataDir,'library');this.pending=new Map();}
  async get(id,plate) {
    requireThat(/^[a-f0-9]{64}$/.test(id)&&Number.isSafeInteger(plate)&&plate>0,'NOT_FOUND','Vista previa no encontrada.',404);
    const item=this.store.libraryItem(id);
    requireThat(item?.plates.some(p=>p.index===plate),'NOT_FOUND','Vista previa no encontrada.',404);
    const key=`${id}-${plate}-v1`;
    if(this.pending.has(key))return this.pending.get(key);
    const task=this.load(key,id,plate);this.pending.set(key,task);
    try{return await task;}finally{this.pending.delete(key);}
  }
  async load(key,id,plate) {
    const cached=path.join(this.directory,key+'.png');
    try{const image=await readFile(cached);if(validThumbnail(image))return image;}catch{}
    const image=await readPlateThumbnail(path.join(this.library,id+'.gcode.3mf'),plate);
    if(!image)return null;
    // Cache is expendable: disk errors must not prevent viewing the original.
    const temporary=cached+'.'+randomUUID()+'.tmp';
    try{await mkdir(this.directory,{recursive:true});await writeFile(temporary,image,{flag:'wx'});await rename(temporary,cached);}
    catch{}finally{await unlink(temporary).catch(()=>{});}
    return image;
  }
}
