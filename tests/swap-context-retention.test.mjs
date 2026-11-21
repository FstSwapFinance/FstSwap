import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
test('replacing one warm context releases prior configs, policies and pinned blocks after GC',async()=>{
 const rounds=24;
 const {stdout}=await exec(process.execPath,['--expose-gc',fileURLToPath(new URL('./swap-context-retention-probe.mjs',import.meta.url)),'current',String(rounds)],{timeout:60000,maxBuffer:1024*1024});
 const result=JSON.parse(stdout.trim());
 assert.equal(result.actualFactoryProofs,rounds,'every iteration must exercise the real config/request factory-proof relationship');
 assert.equal(result.rounds,rounds);
 for(const kind of ['config','policy','block'])assert.equal(result.alive[kind],1,`${kind}: bounded current-key Map must retain only the latest completed context`);
});
