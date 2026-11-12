// Cache only pure ABI encodings. Responses and decoded Results stay with the reader.
const implementations=new WeakMap(),MAX_ENTRIES=2048,MAX_BYTES=2*1024*1024,MAX_CODECS=8,MAX_ABI_CHARS=8192;
const unsupported=Symbol('unsupported ABI argument');
function typed(value){
 if(Array.isArray(value))return['array',value.map(typed)];
 const type=typeof value;
 if(type==='bigint')return[type,String(value)];
 if(type==='string'||type==='boolean'||type==='number'&&Number.isSafeInteger(value))return[type,value];
 throw unsupported;
}
export function readCodec(Interface,abi){
 // Current callers use fixed string ABIs. Other ABI representations retain the
 // ordinary ethers behavior rather than inventing an identity for mutable objects.
 const fixed=Array.isArray(abi)&&abi.every(fragment=>typeof fragment==='string'),abiKey=fixed?JSON.stringify(abi):null;
 if(!abiKey||abiKey.length>MAX_ABI_CHARS)return new Interface(abi);
 let owner=implementations.get(Interface);
 if(!owner){owner={codecs:new Map(),entries:new Map(),bytes:0,nextId:0};implementations.set(Interface,owner);}
 const saved=owner.codecs.get(abiKey);if(saved)return saved;
 const instance=new Interface(abi),id=++owner.nextId;
 const codec=Object.freeze({
  encodeFunctionData(method,args=[]){
   let key;
   // Preserve argument types and address case. A previously encoded lowercase
   // address must never bypass ethers' rejection of a bad mixed-case checksum.
   if(typeof method==='string')try{key=JSON.stringify([id,method,typed(args)]);}catch(e){if(e!==unsupported)throw e;}
   if(key!==undefined){const hit=owner.entries.get(key);if(hit){owner.entries.delete(key);owner.entries.set(key,hit);return hit.data;}}
   const data=instance.encodeFunctionData(method,args);
   if(key!==undefined){
    const bytes=(key.length+data.length)*2;
    if(bytes<=MAX_BYTES){
     owner.entries.set(key,{data,bytes});owner.bytes+=bytes;
     while(owner.entries.size>MAX_ENTRIES||owner.bytes>MAX_BYTES){const oldest=owner.entries.keys().next().value;owner.bytes-=owner.entries.get(oldest).bytes;owner.entries.delete(oldest);}
    }
   }
   return data;
  },
  decodeFunctionResult:(...args)=>instance.decodeFunctionResult(...args),
 });
 owner.codecs.set(abiKey,codec);
 if(owner.codecs.size>MAX_CODECS)owner.codecs.delete(owner.codecs.keys().next().value);
 return codec;
}
