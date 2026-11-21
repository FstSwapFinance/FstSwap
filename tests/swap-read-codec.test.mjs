import test from'node:test';
import assert from'node:assert/strict';
import{ethers}from'ethers';
import{readCodec}from'../src/swap-read-codec.mjs';
const ABI=['function check(address,uint256) view returns(uint256)'],A='0x52908400098527886E0F7030069857D2E4169EE7';
function counted(){
 const counts={constructs:0,encodes:0,decodes:0};
 class I extends ethers.Interface{
  constructor(abi){super(abi);counts.constructs++;}
  encodeFunctionData(...args){counts.encodes++;return super.encodeFunctionData(...args);}
  decodeFunctionResult(...args){counts.decodes++;return super.decodeFunctionResult(...args);}
 }
 return{I,counts};
}
test('identical pure encoding is memoized without changing calldata or caching decoded chain data',()=>{
 const{I,counts}=counted(),c=readCodec(I,ABI),raw=new ethers.Interface(ABI);
 assert.equal(c.encodeFunctionData('check',[A,1n]),raw.encodeFunctionData('check',[A,1n]));
 assert.equal(c.encodeFunctionData('check',[A,1n]),raw.encodeFunctionData('check',[A,1n]));assert.equal(counts.encodes,1);
 const a=c.decodeFunctionResult('check',raw.encodeFunctionResult('check',[1n])),b=c.decodeFunctionResult('check',raw.encodeFunctionResult('check',[2n]));
 assert.equal(a[0],1n);assert.equal(b[0],2n);assert.notEqual(a,b);assert.equal(counts.decodes,2);
 assert.equal(readCodec(I,[...ABI]),c);assert.equal(counts.constructs,1);
});
test('method spelling, ABI, implementation identity and typed argument values remain separate',()=>{
 const{I,counts}=counted(),c=readCodec(I,ABI),arg=[A,1n];
 c.encodeFunctionData('check',arg);arg[1]=2n;c.encodeFunctionData('check',arg);arg[1]='1';c.encodeFunctionData('check',arg);arg[1]=1;c.encodeFunctionData('check',arg);
 c.encodeFunctionData('check(address,uint256)',[A,1n]);assert.equal(counts.encodes,5);
 const other=readCodec(I,['function check(address,uint256) view returns(address)']);other.encodeFunctionData('check',[A,1n]);assert.equal(counts.encodes,6);assert.notEqual(c,other);
 const second=counted();readCodec(second.I,ABI).encodeFunctionData('check',[A,1n]);assert.equal(second.counts.encodes,1);assert.equal(second.counts.constructs,1);
});
test('cached lowercase address does not accept an invalid mixed-case checksum or hide encoding errors',()=>{
 const{I,counts}=counted(),c=readCodec(I,ABI),lower=A.toLowerCase(),bad='0x52908400098527886e0F7030069857D2E4169EE7';
 c.encodeFunctionData('check',[lower,1n]);assert.throws(()=>c.encodeFunctionData('check',[bad,1n]),/checksum/);
 assert.throws(()=>c.encodeFunctionData('check',[bad,1n]),/checksum/);assert.equal(counts.encodes,3,'failures are never memoized');
 assert.throws(()=>c.encodeFunctionData('check',[lower,-1n]),/out-of-bounds/);
});
test('nested arrays preserve CALL order, bytes, case and each integer amount',()=>{
 const{I,counts}=counted(),abi=['function batch((address,bytes,uint256)[])'],c=readCodec(I,abi),a=[[A,'0x1234',3n],[ethers.ZeroAddress,'0xab',4n]];
 const first=c.encodeFunctionData('batch',[a]);assert.equal(c.encodeFunctionData('batch',[[...a]]),first);assert.equal(counts.encodes,1);
 assert.notEqual(c.encodeFunctionData('batch',[[...a].reverse()]),first);a[0][2]=5n;assert.notEqual(c.encodeFunctionData('batch',[a]),first);assert.equal(counts.encodes,3);
});
test('unsupported object arguments retain ordinary ethers encoding and are never cached',()=>{
 const{I,counts}=counted(),c=readCodec(I,['function named((uint256 amount))']),args=[{amount:3n}];
 assert.equal(c.encodeFunctionData('named',args),c.encodeFunctionData('named',args));assert.equal(counts.encodes,2);
});
test('entry budget evicts old encodings without a sliding overflow',()=>{
 const{I,counts}=counted(),c=readCodec(I,['function one(uint256)']);
 c.encodeFunctionData('one',[0n]);for(let n=1;n<=2048;n++)c.encodeFunctionData('one',[BigInt(n)]);
 const before=counts.encodes;c.encodeFunctionData('one',[2048n]);assert.equal(counts.encodes,before,'recent completed string remains cached');
 c.encodeFunctionData('one',[0n]);assert.equal(counts.encodes,before+1,'oldest entry was evicted by the shared count limit');
});
test('byte budget evicts a full payload and oversized strings are not retained',()=>{
 const{I,counts}=counted(),c=readCodec(I,['function blob(bytes)']);
 const payload=n=>'0x'+n.toString(16).padStart(2,'0').repeat(150000);
 const first=payload(1),last=payload(5);for(let n=1;n<=5;n++)c.encodeFunctionData('blob',[payload(n)]);
 const before=counts.encodes;c.encodeFunctionData('blob',[last]);assert.equal(counts.encodes,before);
 c.encodeFunctionData('blob',[first]);assert.equal(counts.encodes,before+1,'combined key plus result bytes are bounded below the entry count cap');
 const oversized='0x'+'ab'.repeat(550000),start=counts.encodes;c.encodeFunctionData('blob',[oversized]);c.encodeFunctionData('blob',[oversized]);assert.equal(counts.encodes,start+2);
});
test('codec registry stays bounded and mutable ABI arrays use their current exact signature',()=>{
 const{I,counts}=counted(),abi=['function value(uint256)'],first=readCodec(I,abi);first.encodeFunctionData('value',[1n]);
 abi[0]='function changed(uint256)';readCodec(I,abi).encodeFunctionData('changed',[1n]);assert.equal(counts.constructs,2);
 for(let n=0;n<8;n++)readCodec(I,[`function separate${n}(uint256)`]);
 const start=counts.constructs;assert.notEqual(readCodec(I,['function value(uint256)']),first);assert.equal(counts.constructs,start+1);
});
