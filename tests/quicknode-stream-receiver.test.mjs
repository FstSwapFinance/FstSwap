import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {request as httpRequest} from 'node:http';

const SECRET='test-stream-secret-with-at-least-32-characters',NOW=1794426000000;
const receiver=await import('../server/quicknode-stream-receiver.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return{};throw error;
});
test('receiver exports its isolated server and durable store factories',()=>{
 assert.equal(typeof receiver.createStreamStore,'function');
 assert.equal(typeof receiver.createStreamServer,'function');
});

const signature=(body,nonce,timestamp)=>createHmac('sha256',SECRET).update(nonce+timestamp).update(body).digest('hex');
function envelope(block=133000001,hash='0x'+'11'.repeat(32)){
 return JSON.stringify({data:[{filteredReceipts:[{blockNumber:'0x'+block.toString(16),blockHash:hash,logs:[]}]}],metadata:{network:'bnbchain-mainnet',start_block:block,end_block:block}});
}
function headers(body,{nonce='nonce-a',timestamp=String(NOW/1000),sig}={}){
 return{'content-type':'application/json','x-qn-nonce':nonce,'x-qn-timestamp':timestamp,'x-qn-signature':sig??signature(body,nonce,timestamp)};
}
async function setup(t,options={}){
 const directory=mkdtempSync(join(tmpdir(),'fstswap-stream-test-')),dbPath=join(directory,'streams.sqlite');
 const store=receiver.createStreamStore({dbPath,clock:()=>NOW});
 const server=receiver.createStreamServer({secret:SECRET,store,clock:()=>NOW,...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});});
 return {directory,dbPath,store,server,base,post:(body,extra={})=>fetch(base+'/api/streams/pancake',{method:'POST',headers:headers(body,extra),body})};
}

test('valid signed historical payload commits before ACK and persists exact compressed bytes',async t=>{
 const {post,dbPath,store}=await setup(t),body=envelope();
 const response=await post(body);assert.equal(response.status,200);assert.deepEqual(await response.json(),{accepted:true,duplicate:false});
 const db=new DatabaseSync(dbPath,{readOnly:true});t.after(()=>db.close());
 const row=db.prepare('SELECT payload_gzip,metadata,first_block,last_block FROM deliveries').get();
 assert.equal(gunzipSync(row.payload_gzip).toString(),body);assert.equal(JSON.parse(row.metadata).network,'bnbchain-mainnet');
 assert.equal(row.first_block,133000001);assert.equal(row.last_block,133000001);
 assert.equal(store.health().deliveryCount,1);assert.equal(statSync(dbPath).mode&0o777,0o600);
});

test('invalid, short, or missing signatures cannot append deliveries',async t=>{
 const {post,base,store}=await setup(t),body=envelope();
 for(const sig of ['00'.repeat(32),'abcd','not-hex'])assert.equal((await post(body,{sig})).status,401);
 assert.equal((await fetch(base+'/api/streams/pancake',{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 assert.equal(store.health().deliveryCount,0);
});

test('signed printable nonces are not limited to a guessed hexadecimal format',async t=>{
 const {post}=await setup(t);assert.equal((await post(envelope(),{nonce:'stream.delivery+/=42'})).status,200);
});

test('gzip HMAC authenticates decoded original JSON rather than compressed bytes',async t=>{
 const {base,store}=await setup(t),body=envelope(),compressed=gzipSync(body);
 let response=await fetch(base+'/api/streams/pancake',{method:'POST',headers:{...headers(body),'content-encoding':'gzip'},body:compressed});
 assert.equal(response.status,200);assert.equal(store.health().deliveryCount,1);
 response=await fetch(base+'/api/streams/pancake',{method:'POST',headers:{...headers(compressed,{nonce:'wrong-compressed-signature'}),'content-encoding':'gzip'},body:compressed});
 assert.equal(response.status,401);assert.equal(store.health().deliveryCount,1);
});

test('same nonce or same payload retries are durable idempotent ACKs',async t=>{
 const {post,store,dbPath}=await setup(t),body=envelope();
 assert.equal((await post(body)).status,200);
 assert.deepEqual(await (await post(body)).json(),{accepted:true,duplicate:true});
 assert.deepEqual(await (await post(body,{nonce:'nonce-b'})).json(),{accepted:true,duplicate:true});
 assert.equal(store.health().deliveryCount,1);
 const reopened=receiver.createStreamStore({dbPath,clock:()=>NOW});t.after(()=>reopened.close());
 assert.equal(reopened.health().deliveryCount,1);
 assert.equal(reopened.append({nonce:'nonce-a',timestamp:String(NOW/1000),payload:Buffer.from(body)}).duplicate,true);
});

test('nonce reused for different signed payload is rejected without overwriting history',async t=>{
 const {post,store}=await setup(t);
 assert.equal((await post(envelope())).status,200);
 assert.equal((await post(envelope(133000002))).status,409);
 assert.equal(store.health().deliveryCount,1);
});

test('stale and future signature timestamps reject replay while historical block dates are accepted',async t=>{
 const {post,store}=await setup(t),body=envelope(6809737);
 assert.equal((await post(body,{timestamp:String(NOW/1000-301)})).status,401);
 assert.equal((await post(body,{timestamp:String(NOW/1000+301)})).status,401);
 assert.equal((await post(body,{timestamp:String(NOW)})).status,401);
 assert.equal((await post(body)).status,200);assert.equal(store.health().deliveryCount,1);
});

test('wire, expanded-body, JSON and compression boundaries never acknowledge invalid bodies',async t=>{
 const {base,post,store}=await setup(t,{maxWireBytes:1024,maxDecodedBytes:2048});
 const large=JSON.stringify({data:'a'.repeat(4096)});
 assert.equal((await post(large)).status,413);
 assert.equal((await fetch(base+'/api/streams/pancake',{method:'POST',headers:{...headers(large),'content-encoding':'gzip'},body:gzipSync(large)})).status,413);
 assert.equal((await post('{broken json')).status,400);
 assert.equal((await post('null')).status,400);
 assert.equal((await fetch(base+'/api/streams/pancake',{method:'POST',headers:{...headers('{}'),'content-encoding':'br'},body:'{}'})).status,415);
 assert.equal((await fetch(base+'/api/streams/pancake',{method:'POST',headers:{...headers('{}'),'content-encoding':'gzip'},body:'{}'})).status,400);
 assert.equal(store.health().deliveryCount,0);
});

test('chunked wire overflow is rejected before processing or persistence',async t=>{
 const {base,store}=await setup(t,{maxWireBytes:1024}),body=JSON.stringify({data:'a'.repeat(4096)});
 const response=await fetch(base+'/api/streams/pancake',{method:'POST',headers:headers(body),body:Readable.from([body.slice(0,500),body.slice(500)]),duplex:'half'});
 assert.equal(response.status,413);assert.equal(store.health().deliveryCount,0);
});

test('slow request bodies time out without blocking later deliveries',async t=>{
 const {base,store}=await setup(t,{bodyTimeoutMs:30}),body=envelope();
 const status=await new Promise((resolve,reject)=>{
  const req=httpRequest(base+'/api/streams/pancake',{method:'POST',headers:{...headers(body),'content-length':Buffer.byteLength(body)}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});
  req.once('error',reject);req.write(body.slice(0,1));
 });
 assert.equal(status,408);assert.equal(store.health().deliveryCount,0);
});

test('invalid UTF-8 cannot turn into replacement characters before persistence',async t=>{
 const {base,store}=await setup(t),body=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]);
 const response=await fetch(base+'/api/streams/pancake',{method:'POST',headers:headers(body),body});
 assert.equal(response.status,400);assert.equal(store.health().deliveryCount,0);
});

test('reorg payloads at the same block with different hashes are both retained',async t=>{
 const {post,store}=await setup(t);
 assert.equal((await post(envelope())).status,200);
 assert.equal((await post(envelope(133000001,'0x'+'22'.repeat(32)),{nonce:'reorg-nonce'})).status,200);
 assert.equal(store.health().deliveryCount,2);
});

test('database write failure returns retryable 503 rather than a success ACK',async t=>{
 const {post,store}=await setup(t);store.close();
 const response=await post(envelope());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'STORAGE_UNAVAILABLE'});
});

test('public health contains only aggregate delivery status and no secrets or raw payload',async t=>{
 const {post,base}=await setup(t);await post(envelope());
 const response=await fetch(base+'/health'),text=await response.text();assert.equal(response.status,200);
 const health=JSON.parse(text);assert.equal(health.deliveryCount,1);assert.equal(health.firstBlock,133000001);assert.equal(health.lastBlock,133000001);assert.equal(health.lastReceivedAt,NOW);
 for(const hidden of [SECRET,'nonce-a','filteredReceipts','payload_gzip','blockHash'])assert.equal(text.includes(hidden),false);
 assert.equal((await fetch(base+'/api/streams/pancake')).status,405);
 assert.equal((await fetch(base+'/wrong')).status,404);
});
