import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const mock=`export class TFile{constructor(path){this.path=path;}};export class TFolder{};export class Modal{};export class Notice{};export class SuggestModal{};`;
const out=await build({entryPoints:['src/agent-tools.ts','src/agent-instructions.ts'],bundle:true,write:false,outdir:'out',format:'esm',loader:{'.md':'text'},plugins:[{name:'host',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'host',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock}));}}]});
const modules=await Promise.all(out.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const {instructions,lineChanges}=modules[1];const {exportNew}=modules[0];
test('versioned instructions preserve scope and require fresh retrieval, full text, explicit mode and review',()=>{const docs=instructions({sources:'Sources',cards:'Cards',allowed:'Cards, Existing',excluded:'Private'});assert.equal(docs.length,3);for(const [i,d] of docs.entries()){assert.ok(d.text.includes('instruction_version: '+[3,3,3][i]));assert.ok(!d.text.includes('instruction_version: 2'),'交叉引用不得停留在旧版说明');assert.ok(d.text.includes('protocol_version: 1'));assert.ok(d.text.includes('Private'));assert.ok(!d.text.includes('{{CONFIG}}'));}assert.ok(docs[0].text.includes('manifest'));assert.ok(docs[1].text.includes('suggestion_id'));for(const term of ['STALE_INDEX','actualMode','candidateOnly','get','--allow-keyword-fallback'])assert.ok(docs[2].text.includes(term),term);assert.ok(docs[1].text.includes('不建议加链'));assert.throws(()=>instructions({sources:'../bad',cards:'Cards',allowed:'Cards',excluded:''}));assert.match(lineChanges('old','new'),/- old\n\+ new/);});
// Use one bundle identity for TFile by exporting a test-only mock getter.
test('export never modifies existing notes, uses new version and handles repeat export',async()=>{
 const bundle=await build({stdin:{contents:"export {exportNew} from './src/agent-tools';export {TFile,TFolder} from 'obsidian';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',loader:{'.md':'text'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'host',namespace:'m'}));b.onLoad({filter:/.*/,namespace:'m'},()=>({contents:mock}));}}]});const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const fs=new Map(),contents=new Map();const app={vault:{getAbstractFileByPath:p=>fs.get(p),getFiles:()=>[...fs.values()].filter(f=>f instanceof m.TFile),read:async f=>contents.get(f.path),createFolder:async p=>fs.set(p,new m.TFolder()),create:async(p,s)=>{assert.ok(!fs.has(p));fs.set(p,new m.TFile(p));contents.set(p,s);}}};
 assert.equal(await m.exportNew(app,{path:'Carddesk/test.md',text:'v1'}),'Carddesk/test.md');assert.equal(await m.exportNew(app,{path:'Carddesk/test.md',text:'v1'}),'Carddesk/test.md');contents.set('Carddesk/test.md','user-edited');assert.equal(await m.exportNew(app,{path:'Carddesk/test.md',text:'v1'}),'Carddesk/test.v1-1.md');assert.equal(contents.get('Carddesk/test.md'),'user-edited');
 assert.equal(await m.exportNew(app,{path:'Carddesk/test.md',text:'---\ninstruction_version: 2\n---\nv2'}),'Carddesk/test.v2-1.md');assert.equal(contents.get('Carddesk/test.md'),'user-edited');
 const v2={path:'Carddesk/test.md',text:'---\ninstruction_version: 2\n---\nv2'};
 assert.equal(await m.exportNew(app,v2),'Carddesk/test.v2-1.md');
 contents.set('Carddesk/test.v2-1.md','user-edited-v2');
 assert.equal(await m.exportNew(app,v2),'Carddesk/test.v2-2.md');
 fs.delete('Carddesk/test.v2-1.md');contents.delete('Carddesk/test.v2-1.md');
 assert.equal(await m.exportNew(app,v2),'Carddesk/test.v2-2.md');
 assert.equal(fs.has('Carddesk/test.v2-1.md'),false);
});
