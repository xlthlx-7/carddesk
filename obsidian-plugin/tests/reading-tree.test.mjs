import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['src/reading-tree.ts'],bundle:true,write:false,format:'esm'});
const {ReadingTree}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
test('tree enforces identity, parent liveness, limit and subtree deletion',()=>{
 const t=new ReadingTree(5),a=t.add('A',null),b=t.add('B',a),c=t.add('C',a),d1=t.add('D',b),d2=t.add('D',c);
 assert.notEqual(d1.id,d2.id);assert.equal(t.ancestor(d1,'A'),a);assert.equal(t.ancestor(c,'B'),null);
 assert.throws(()=>t.add('X',c));assert.throws(()=>t.add('C',a));
 t.remove(b);assert.equal(t.nodes.size,3);assert.deepEqual(a.children,[c]);assert.throws(()=>t.add('E',b));
 t.remove(a);assert.equal(t.nodes.size,0);
});
