import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[];let selected;
 function script(){const listeners=new Map();return{dataset:{},addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type){for(const fn of [...listeners.get(type)||[]])fn();},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);},remove(){throw Error('Recovery must not remove/reexecute vendor');}};}
 selected=script();const context={location:{hash:'#/swap'},document:{querySelector:()=>selected},render:()=>calls.push(context.location.hash),Promise};vm.createContext(context);
 const start=source.indexOf('let rendering = 0;'),end=source.indexOf('async function render()',start);assert.ok(start>=0&&end>start,'real application recovery helper must exist');
 vm.runInContext(source.slice(start,end)+'\nglobalThis.api={arm:recoverLateLibrary,cancel:()=>stopLibraryRecovery(),ticket:value=>{rendering=value;}};',context);
 context.api.ticket(1);return{context,calls,api:context.api,script:selected,newScript(){selected=script();return selected;},ready(){context.ethers={Interface(){},parseUnits(){}};}};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('a late ready event requests one rerender and releases both original-script listeners',async()=>{
 const f=fixture();f.api.arm(1,'#/swap');assert.equal(f.script.count(),2);f.ready();f.script.emit('load');f.script.emit('load');await flush();assert.deepEqual(f.calls,['#/swap']);assert.equal(f.script.count(),0);
});
test('already-ready and ready-before-queued-resume races stay bound to their original ticket and hash',async()=>{
 const f=fixture();f.ready();f.api.arm(1,'#/swap');assert.equal(f.script.count(),0);await flush();assert.deepEqual(f.calls,['#/swap']);
 f.calls.length=0;f.api.arm(1,'#/swap');f.context.location.hash='#/my';await flush();assert.deepEqual(f.calls,[]);
 f.context.location.hash='#/swap';f.api.arm(1,'#/swap');f.api.ticket(2);await flush();assert.deepEqual(f.calls,[]);
});
test('changing the rendered view removes old listeners so a stale vendor event cannot revive it',async()=>{
 const f=fixture();f.api.arm(1,'#/swap');f.api.cancel();assert.equal(f.script.count(),0);f.api.ticket(2);f.context.location.hash='#/my';const next=f.newScript();f.api.arm(2,'#/my');f.ready();f.script.emit('load');await flush();assert.deepEqual(f.calls,[]);next.emit('load');await flush();assert.deepEqual(f.calls,['#/my']);assert.equal(next.count(),0);
});
test('an error or later render cleanup only detaches recovery and never retries execution',async()=>{
 const f=fixture();f.api.arm(1,'#/swap');f.script.emit('error');f.ready();f.script.emit('load');await flush();assert.deepEqual(f.calls,[]);assert.equal(f.script.count(),0);
 const g=fixture();g.api.arm(1,'#/swap');g.api.cancel();g.ready();g.script.emit('load');await flush();assert.deepEqual(g.calls,[]);assert.equal(g.script.count(),0);
});
