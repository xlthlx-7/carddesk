import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const mock = `
export class Component {
 children=[]; disposers=[];
 addChild(c){this.children.push(c);return c;}
 removeChild(c){this.children=this.children.filter(x=>x!==c);c.unload();return c;}
 registerDomEvent(el,type,fn,options){el.addEventListener(type,fn,options);this.disposers.push(()=>el.removeEventListener(type,fn,options));}
 unload(){for(const c of this.children)c.unload();for(const d of this.disposers)d();this.children=[];this.disposers=[];}
}
export class ItemView extends Component {constructor(leaf){super();this.app=leaf.app;this.contentEl=document.createElement('div');document.body.append(this.contentEl);}}
export class TFile {}
globalThis.MockFile=TFile;
export class Notice {constructor(message){globalThis.notices.push(message);}}
export const getLinkpath=s=>s.split('#')[0];
export class MarkdownRenderer {static async render(app,md,el,source,component){
 app.renders.push(source);
 if(app.renderGate) await app.renderGate;
 for(const ref of md.split(',')){const a=document.createElement('a');a.className='internal-link';a.dataset.href=ref;a.href='#';a.textContent=ref;el.append(a);}
 // Simulate the renderer's native handler: capture on card must suppress it.
 el.addEventListener('click',e=>{if(e.target.closest('a'))app.native.push(source);});
}}
`;
const bundle = await build({entryPoints:['src/reading-view.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'mock-obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock,loader:'js'}));}}]});
const {ReadingView} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
function setup(){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://test.invalid'});
 globalThis.document=dom.window.document;globalThis.notices=[];
 const p=dom.window.HTMLElement.prototype;
 p.createEl=function(tag,o={}){const e=document.createElement(tag);if(o.cls)e.className=o.cls;if(o.text)e.textContent=o.text;this.append(e);return e;};
 p.createDiv=function(o){return this.createEl('div',o);};p.addClass=function(c){this.classList.add(c);};p.empty=function(){this.replaceChildren();};p.setText=function(t){this.textContent=t;};p.scrollIntoView=function(){};
 const files=Object.fromEntries(['A','B','C','D','image.png'].map(name=>[name,Object.assign(new globalThis.MockFile(),{path:'P0/'+name+(name.includes('.')?'':'.md'),basename:name,extension:name.includes('.')?'png':'md'})]));
 const text={A:'B,C',B:'D',C:'D',D:'A'};
 const app={native:[],renders:[],workspace:{openLinkText:async(...args)=>app.native.push(args)},metadataCache:{getFirstLinkpathDest:(ref,source)=>{assert.ok(source.startsWith('P0/'));return files[ref.replace(/^P0\//,'').replace(/\.md$/,'')];}},vault:{cachedRead:async f=>text[f.basename],getAbstractFileByPath:path=>Object.values(files).find(f=>f.path===path),getMarkdownFiles:()=>Object.values(files).filter(f=>f.extension==='md')}};
 const view=new ReadingView({app});
 const click=(node,ref,options={})=>{const a=[...node.body.querySelectorAll('a')].find(a=>a.dataset.href===ref);assert.ok(a);const e=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true,...options});a.dispatchEvent(e);return e;};
 return {view,files,app,dom,click};
}
test('links expand in place, shared targets remain independent, ancestor returns, close cleans components',async()=>{
 const {view,files,app,click}=setup();await view.onOpen();await view.openRoot(files.A);
 assert.equal(click(view.root,'B').defaultPrevented,true);await settle();
 click(view.root,'C');await settle();
 const [b,c]=view.root.children;click(b,'D');click(c,'D');await settle();
 assert.equal(view.count,5);assert.equal(b.children.length,1);assert.equal(c.children.length,1);
 click(b.children[0],'A');await settle();assert.equal(view.count,5);assert.equal(app.native.length,0);
 click(view.root,'B');await settle();assert.equal(view.count,3);assert.equal(view.children.length,3);
 await view.onClose();assert.equal(view.count,0);assert.equal(view.children.length,0);
});
test('modified clicks, heading, attachment and missing links keep native behavior; keyboard expands',async()=>{
 const {view,files,dom,app,click}=setup();app.vault.cachedRead=async()=> 'B,B#heading,image.png,missing';await view.openRoot(files.A);
 for(const [ref,options] of [['B',{metaKey:true}],['B#heading',{}],['image.png',{}],['missing',{}]]) assert.equal(click(view.root,ref,options).defaultPrevented,false);
 assert.equal(view.count,1);
 const a=view.root.body.querySelector('a');const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});a.dispatchEvent(event);await settle();assert.equal(event.defaultPrevented,true);assert.equal(view.count,2);await view.onClose();
});
test('pending reads do not resurrect a closed view',async()=>{
 const {view,files,app,click}=setup();await view.openRoot(files.A);let resolve;app.vault.cachedRead=()=>new Promise(r=>resolve=r);
 click(view.root,'B');click(view.root,'B');assert.equal(view.count,2);
 await view.onClose();resolve('D');await settle();assert.equal(view.count,0);assert.equal(view.children.length,0);assert.equal(view.contentEl.children.length,0);
});
test('older root reads cannot replace a newer root',async()=>{
 const {view,files,app}=setup();let resolve;
 app.vault.cachedRead=f=>f===files.A?new Promise(r=>resolve=r):Promise.resolve('A');
 const old=view.openRoot(files.A);await view.openRoot(files.B);resolve('B');await old;
 assert.equal(view.root.file,files.B);assert.equal(view.count,1);assert.equal(view.children.length,1);await view.onClose();
});
test('failed reads release slots, synchronize links, and allow retry',async()=>{
 const {view,files,app,click}=setup();await view.openRoot(files.A);
 app.vault.cachedRead=async()=>{throw new Error('disk failure');};click(view.root,'B');await settle();
 assert.equal(view.count,1);assert.equal(view.children.length,1);assert.equal(view.root.body.querySelector('a').getAttribute('aria-expanded'),'false');
 app.vault.cachedRead=async()=> 'A';click(view.root,'B');await settle();assert.equal(view.count,2);await view.onClose();
});
test('late render completion unloads resources after branch removal',async()=>{
 const {view,files,click}=setup();await view.openRoot(files.A);
 let resolve;view.app.renderGate=new Promise(r=>resolve=r);
 click(view.root,'B');await settle();const child=view.root.children[0];view.remove(child);resolve();await settle();
 assert.equal(child.disposed,true);assert.equal(child.body.childNodes.length,0);assert.equal(view.count,1);await view.onClose();
});
test('limit includes pending nodes and collapse returns focus to parent',async()=>{
 const {view,files,click}=setup();await view.openRoot(files.A);view.tree.limit=2;
 click(view.root,'B');await settle();click(view.root,'C');await settle();assert.equal(view.count,2);assert.ok(notices.length);
 const parent=view.root.section;click(view.root,'B');await settle();assert.equal(document.activeElement,parent);assert.equal(view.count,1);await view.onClose();
});

test('P0 presentation: no path toolbar or automatic root focus, child focus and parent return',async()=>{
 const {view,files,click}=setup();await view.openRoot(files.A);
 assert.equal(view.contentEl.querySelector('nav'),null);assert.notEqual(document.activeElement,view.root.section);
 click(view.root,'B');await settle();assert.equal(document.activeElement,view.root.children[0].section);
 const buttons=[...view.root.children[0].section.querySelectorAll('button')];buttons.find(b=>b.textContent==='返回上层').click();
 assert.equal(document.activeElement,view.root.section);assert.equal(view.count,2);await view.onClose();
});
test('round-trip preserves two shared instances, order and focus; missing parent retains descendants',async()=>{
 const {view,files,click}=setup();await view.openRoot(files.A);click(view.root,'B');await settle();click(view.root,'C');await settle();click(view.root.children[0],'D');await settle();click(view.root.children[1],'D');await settle();
 const s=view.snapshot();await view.onClose();await view.restore(s);assert.equal(view.count,5);assert.deepEqual(view.snapshot().nodes.map(n=>n.filePath),s.nodes.map(n=>n.filePath));assert.equal(document.activeElement,view.root.children[1].children[0].section);
 delete files.B;await view.restore(s);assert.equal(view.root.children[0].missing,true);assert.equal(view.root.children[0].children.length,1);assert.equal(view.count,5);await view.onClose();
});
test('modify keeps branches, rename updates snapshot, delete keeps placeholder and relink resolves it',async()=>{
 const {view,files,app,click}=setup();await view.openRoot(files.A);click(view.root,'B');await settle();click(view.root.children[0],'D');await settle();
 app.vault.cachedRead=async()=> 'C';await view.fileChanged(files.B.path,'modify');assert.equal(view.count,3);assert.match(view.root.children[0].section.textContent,/原链接已变更/);
 const old=files.B.path;files.B.path='P0/Renamed.md';files.B.basename='Renamed';await view.fileChanged(files.B.path,'rename',old);assert.equal(view.snapshot().nodes[1].filePath,'P0/Renamed.md');
 await view.fileChanged(files.B.path,'delete');assert.equal(view.root.children[0].missing,true);assert.equal(view.count,3);
 await view.relink(String(view.root.children[0].state.id),files.C);assert.equal(view.root.children[0].missing,false);assert.equal(view.snapshot().nodes[1].filePath,files.C.path);await view.onClose();
});
test('card identity relocation and duplicate identity ambiguity',async()=>{
 const {view,files,app}=setup();const ids=new Map([[files.A,'id-A']]);app.metadataCache.getFileCache=f=>({frontmatter:{card_id:ids.get(f)}});
 await view.openRoot(files.A);const s=view.snapshot();files.A.path='P0/Moved.md';await view.restore(s);assert.equal(view.snapshot().nodes[0].filePath,'P0/Moved.md');
 ids.set(files.B,'id-A');await view.restore(s);assert.equal(view.root.missing,true);await view.onClose();
});
test('external move arriving as delete then metadata change repairs identity placeholders',async()=>{
 const {view,files,app,click}=setup();app.metadataCache.getFileCache=f=>({frontmatter:{card_id:f===files.B?'b':undefined}});
 await view.openRoot(files.A);click(view.root,'B');await settle();await view.fileChanged(files.B.path,'delete');assert.equal(view.root.children[0].missing,true);
 app.vault.cachedRead=async()=> 'A';files.B.path='P0/Moved.md';files.B.basename='Moved';await view.fileChanged(files.B.path,'modify');assert.equal(view.root.children[0].missing,false);assert.equal(view.snapshot().nodes[1].filePath,'P0/Moved.md');await view.onClose();
});

test('P4 two views keep independent trees and closing one leaves the other usable',async()=>{
 const {view,files,app,click}=setup();
 const other=new ReadingView({app});
 await view.openRoot(files.A);await other.openRoot(files.A);
 click(view.root,'B');await settle();
 assert.equal(view.count,2);assert.equal(other.count,1);
 click(other.root,'C');await settle();
 assert.equal(view.root.children[0].file,files.B);assert.equal(other.root.children[0].file,files.C);
 await view.onClose();assert.equal(view.count,0);assert.equal(other.count,2);
 click(other.root.children[0],'D');await settle();assert.equal(other.count,3);
 await other.onClose();assert.equal(other.count,0);
});
