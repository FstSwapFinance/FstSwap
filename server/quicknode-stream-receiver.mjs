// Independent Streams intake. Stored events are historical data, never quote authority.
import {createServer} from 'node:http';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdirSync,chmodSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzip} from 'node:zlib';
import {promisify,TextDecoder} from 'node:util';

const inflate=promisify(gunzip),POST_PATH='/api/streams/pancake';
const failure=(status,code)=>Object.assign(new Error(code),{status,code});
const jsonObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestampValid=value=>typeof value==='string'&&/^\d{10}$/.test(value);
const secretValid=value=>typeof value==='string'&&value.length>=32&&value.length<=4096;
const digest=payload=>createHash('sha256').update(payload).digest('hex');

// Restrict traversal to the documented envelope/receipt fields. Log data is opaque.
function blockRange(envelope){
 const numbers=[];
 const add=value=>{
  if(typeof value!=='string'&&typeof value!=='number')return;
  if(typeof value==='string'&&!/^(?:0x[0-9a-f]+|\d+)$/i.test(value))return;
  const number=Number(value);if(Number.isSafeInteger(number)&&number>=0)numbers.push(number);
 };
 const metadata=envelope.metadata;
 if(jsonObject(metadata))for(const key of['start_block','end_block','startBlock','endBlock'])add(metadata[key]);
 const parts=Array.isArray(envelope.data)?envelope.data:[envelope.data??envelope];
 for(const part of parts){
  if(!jsonObject(part))continue;
  add(part.blockNumber);add(part.block_number);
  if(Array.isArray(part.filteredReceipts))for(const receipt of part.filteredReceipts){if(jsonObject(receipt))add(receipt.blockNumber);}
 }
 if(!numbers.length)return{first:null,last:null};
 let first=numbers[0],last=first;for(const number of numbers){first=Math.min(first,number);last=Math.max(last,number);}
 return{first,last};
}

/** Durable idempotent spool. Callers verify signatures before append(). */
export function createStreamStore({dbPath,clock=Date.now}={}){
 if(typeof dbPath!=='string'||!dbPath||dbPath===':memory:')throw new TypeError('A durable database path is required');
 const file=resolve(dbPath);mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const db=new DatabaseSync(file);chmodSync(file,0o600);let closed=false;
 try{
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS deliveries(
    id INTEGER PRIMARY KEY,
    body_hash TEXT NOT NULL UNIQUE,
    signed_at TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    first_block INTEGER,
    last_block INTEGER,
    metadata TEXT,
    payload_gzip BLOB NOT NULL
   );
   CREATE TABLE IF NOT EXISTS delivery_nonces(
    nonce TEXT PRIMARY KEY,
    body_hash TEXT NOT NULL REFERENCES deliveries(body_hash),
    signed_at TEXT NOT NULL
   );`);
 }catch(error){db.close();throw error;}
 const findNonce=db.prepare('SELECT body_hash FROM delivery_nonces WHERE nonce=?');
 const findDelivery=db.prepare('SELECT id FROM deliveries WHERE body_hash=?');
 const addDelivery=db.prepare('INSERT INTO deliveries(body_hash,signed_at,received_at,first_block,last_block,metadata,payload_gzip) VALUES(?,?,?,?,?,?,?)');
 const addNonce=db.prepare('INSERT INTO delivery_nonces(nonce,body_hash,signed_at) VALUES(?,?,?)');
 const status=db.prepare('SELECT COUNT(*) AS deliveryCount,MIN(first_block) AS firstBlock,MAX(last_block) AS lastBlock,MAX(received_at) AS lastReceivedAt FROM deliveries');
 return{
  append({nonce,timestamp,payload}){
   if(closed)throw failure(503,'STORAGE_UNAVAILABLE');
   const hash=digest(payload);let transaction=false;
   try{
    db.exec('BEGIN IMMEDIATE');transaction=true;
    const priorNonce=findNonce.get(nonce);
    if(priorNonce&&priorNonce.body_hash!==hash)throw failure(409,'NONCE_CONFLICT');
    const duplicate=!!findDelivery.get(hash);
    if(!duplicate){
     const envelope=JSON.parse(payload.toString('utf8')),range=blockRange(envelope);
     addDelivery.run(hash,timestamp,clock(),range.first,range.last,envelope.metadata==null?null:JSON.stringify(envelope.metadata),gzipSync(payload,{level:1}));
    }
    if(!priorNonce)addNonce.run(nonce,hash,timestamp);
    db.exec('COMMIT');transaction=false;
    return{duplicate};
   }catch(error){
    if(transaction)try{db.exec('ROLLBACK');}catch{}
    if(error.code==='NONCE_CONFLICT')throw error;
    throw failure(503,'STORAGE_UNAVAILABLE');
   }
  },
  health(){if(closed)throw failure(503,'STORAGE_UNAVAILABLE');return{...status.get()};},
  close(){if(!closed){closed=true;db.close();}},
 };
}

function authHeaders(req,secret,clock,maxAgeMs){
 const nonce=req.headers['x-qn-nonce'],timestamp=req.headers['x-qn-timestamp'],signature=req.headers['x-qn-signature'];
 if(typeof nonce!=='string'||! /^[\x21-\x7e]{1,256}$/.test(nonce)
  ||!timestampValid(timestamp)||Math.abs(clock()-Number(timestamp)*1000)>maxAgeMs
  ||typeof signature!=='string'||! /^[0-9a-f]{64}$/i.test(signature))throw failure(401,'INVALID_SIGNATURE');
 return{nonce,timestamp,signature:Buffer.from(signature,'hex'),secret};
}
function readBody(req,limit,timeoutMs){
 return new Promise((resolve,reject)=>{
  const chunks=[];let length=0,finished=false;
  const cleanup=()=>{clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',error);req.removeListener('aborted',aborted);};
  const fail=reason=>{if(finished)return;finished=true;cleanup();req.pause();reject(reason);};
  const data=chunk=>{length+=chunk.length;if(length>limit)return fail(failure(413,'BODY_LIMIT'));chunks.push(chunk);};
  const end=()=>{if(finished)return;finished=true;cleanup();resolve(Buffer.concat(chunks,length));};
  const error=()=>fail(failure(400,'INVALID_BODY')),aborted=()=>fail(failure(400,'INVALID_BODY'));
  const timer=setTimeout(()=>fail(failure(408,'BODY_TIMEOUT')),timeoutMs);timer.unref();
  req.on('data',data);req.on('end',end);req.on('error',error);req.on('aborted',aborted);
 });
}

/** HTTP server binds only to loopback in the executable entrypoint. */
export function createStreamServer({secret,store,clock=Date.now,maxAgeMs=300000,maxWireBytes=4*1024*1024,maxDecodedBytes=16*1024*1024,maxActive=4,bodyTimeoutMs=10000}={}){
 if(!secretValid(secret)||typeof store?.append!=='function'||typeof store?.health!=='function')throw new TypeError('Stream secret and store are required');
 for(const value of[maxAgeMs,maxWireBytes,maxDecodedBytes,maxActive,bodyTimeoutMs])if(!Number.isSafeInteger(value)||value<=0)throw new TypeError('Invalid receiver limit');
 let active=0;
 const server=createServer({headersTimeout:5000,requestTimeout:bodyTimeoutMs+5000,maxHeaderSize:8192},async(req,res)=>{
  const reply=(status,body)=>{
   if(res.destroyed)return;
   if(status>=400){res.shouldKeepAlive=false;res.setHeader('Connection','close');}
   res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));
  };
  if(req.url==='/health'&&req.method==='GET'){
   try{return reply(200,{service:'fstswap-stream-receiver',ready:true,...store.health()});}catch{return reply(503,{error:'STORAGE_UNAVAILABLE'});}
  }
  if(req.url!==POST_PATH)return reply(404,{error:'NOT_FOUND'});
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(active>=maxActive)return reply(503,{error:'SERVICE_BUSY'});
  active++;
  try{
   if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||''))throw failure(415,'CONTENT_TYPE');
   const auth=authHeaders(req,secret,clock,maxAgeMs);
   const encoding=req.headers['content-encoding'];if(encoding&&encoding!=='identity'&&encoding!=='gzip')throw failure(415,'CONTENT_ENCODING');
   const contentLength=req.headers['content-length'];
   if(contentLength!==undefined&&(!/^\d+$/.test(contentLength)||Number(contentLength)>maxWireBytes))throw failure(413,'BODY_LIMIT');
   let payload=await readBody(req,maxWireBytes,bodyTimeoutMs);
   if(encoding==='gzip'){
    try{payload=await inflate(payload,{maxOutputLength:maxDecodedBytes});}catch(error){throw failure(error.code==='ERR_BUFFER_TOO_LARGE'?413:400,error.code==='ERR_BUFFER_TOO_LARGE'?'BODY_LIMIT':'INVALID_GZIP');}
   }
   if(payload.length>maxDecodedBytes)throw failure(413,'BODY_LIMIT');
   const expected=createHmac('sha256',auth.secret).update(auth.nonce+auth.timestamp).update(payload).digest();
   if(auth.signature.length!==expected.length||!timingSafeEqual(auth.signature,expected))throw failure(401,'INVALID_SIGNATURE');
   // Check again after reading a slow request; its body cannot extend the replay window.
   if(Math.abs(clock()-Number(auth.timestamp)*1000)>maxAgeMs)throw failure(401,'INVALID_SIGNATURE');
   let envelope;
   try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}catch{throw failure(400,'INVALID_JSON');}
   if(!jsonObject(envelope))throw failure(400,'INVALID_JSON');
   // append() returns only after SQLite COMMIT with synchronous=FULL.
   let result;try{result=await store.append({nonce:auth.nonce,timestamp:auth.timestamp,payload});}catch(error){if(error.code==='NONCE_CONFLICT')throw error;throw failure(503,'STORAGE_UNAVAILABLE');}
   reply(200,{accepted:true,duplicate:result.duplicate});
  }catch(error){reply(Number.isInteger(error.status)?error.status:503,{error:error.status?error.code:'STORAGE_UNAVAILABLE'});}
  finally{active--;}
 });
 server.keepAliveTimeout=5000;return server;
}

if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url){
 // systemd loads this from a root-private EnvironmentFile. Never print secrets.
 const secret=process.env.FSTSWAP_STREAM_SECRET,dbPath=process.env.FSTSWAP_STREAM_DB||'/var/lib/fstswap-streams/pancake.sqlite';
 const port=Number(process.env.FSTSWAP_STREAM_PORT||4386);
 if(!secretValid(secret))throw new Error('A private stream security token is required');
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid stream receiver port');
 process.umask(0o077);
 const store=createStreamStore({dbPath}),server=createStreamServer({secret,store});
 server.listen(port,'127.0.0.1',()=>console.log('FstSwap Streams receiver listening on loopback port '+port));
 for(const signal of['SIGTERM','SIGINT'])process.once(signal,()=>{server.close(()=>{store.close();});server.closeIdleConnections();});
}
