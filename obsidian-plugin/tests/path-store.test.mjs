import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const out=await build({entryPoints:['src/path-store.ts'],bundle:true,write:false,format:'esm'});
const {PathStore,validateSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const sample=()=>({schemaVersion:1,id:'s',name:'探索',rootNodeId:'a',activeNodeId:'d2',nodes:[{nodeId:'a',parentId:null,filePath:'A.md'},{nodeId:'b',parentId:'a',filePath:'B.md'},{nodeId:'d1',parentId:'b',filePath:'D.md'},{nodeId:'c',parentId:'a',filePath:'C.md'},{nodeId:'d2',parentId:'c',filePath:'D.md'}]});
test('snapshot validates shared cards, rejects malformed versions, chains and traversal',()=>{
 assert.deepEqual(validateSnapshot(sample()),sample());
 for(const mutate of [s=>s.schemaVersion=2,s=>s.nodes[1].parentId='later',s=>s.nodes[1].filePath='../B.md',s=>s.nodes[1].nodeId='a',s=>s.nodes.push({...s.nodes[1],nodeId:'e'})]){const s=sample();mutate(s);assert.throws(()=>validateSnapshot(s));}
 const s=sample();s.activeNodeId='gone';assert.equal(validateSnapshot(s).activeNodeId,'a');
});
test('serial writes, auto progress independent of named snapshots, rename updates all',async()=>{
 const writes=[];let release;const store=new PathStore(async d=>{writes.push(d);if(writes.length===1)await new Promise(r=>release=r);},()=>{});
 const first=store.save(sample());await new Promise(r=>setImmediate(r));const next=sample();next.nodes.pop();next.activeNodeId='c';store.update(next);const second=store.flush();
 assert.equal(writes.length,1);release();await first;await second;assert.equal(writes.length,2);assert.equal(writes[1].lastSession.nodes.length,4);assert.equal(writes[1].paths[0].nodes.length,5);
 store.rename('D.md','Moved.md');await store.flush();assert.equal(store.data.paths[0].nodes[2].filePath,'Moved.md');await store.delete('s');assert.equal(store.data.paths.length,0);
});
test('damaged data prevents writes; disk failure is reported and retry retains in-memory progress',async()=>{
 let writes=0;const errors=[];const blocked=new PathStore(async()=>{writes++;},e=>errors.push(e));blocked.load({schemaVersion:99});blocked.update(sample());await blocked.flush();await assert.rejects(blocked.save(sample()));assert.equal(writes,0);
 let fail=true;const store=new PathStore(async()=>{if(fail)throw Error('disk');writes++;},e=>errors.push(e));store.update(sample());await assert.rejects(store.flush());fail=false;await store.flush();assert.equal(writes,1);assert.equal(store.data.lastSession.nodes.length,5);assert.equal(errors.length,2);
});
