export interface PathNode { nodeId:string; parentId:string|null; filePath:string; cardId?:string; }
export interface Snapshot { schemaVersion:1; id:string; name:string; rootNodeId:string; activeNodeId:string; nodes:PathNode[]; }
export interface PathData {schemaVersion:1; lastSession:Snapshot|null; paths:Snapshot[];}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export function validateSnapshot(value:unknown):Snapshot {
 const s=value as Snapshot;
 if (!s || s.schemaVersion!==1 || typeof s.id!=='string' || typeof s.name!=='string' || !Array.isArray(s.nodes) || !s.nodes.length || s.nodes.length>100) throw new Error('阅读路径格式或版本无效');
 const seen=new Set<string>();const siblings=new Set<string>();
 for(const [i,n] of s.nodes.entries()) {
  if (!n || typeof n.nodeId!=='string' || seen.has(n.nodeId) || typeof n.filePath!=='string' || !n.filePath.endsWith('.md') || n.filePath.startsWith('/') || n.filePath.split('/').includes('..') || (n.cardId!==undefined && typeof n.cardId!=='string')) throw new Error('阅读节点无效');
  if(i===0 ? n.parentId!==null || n.nodeId!==s.rootNodeId : typeof n.parentId!=='string' || !seen.has(n.parentId)) throw new Error('阅读父链无效');
  const key=JSON.stringify([n.parentId,n.filePath]);if(siblings.has(key))throw new Error('重复兄弟节点');siblings.add(key);seen.add(n.nodeId);
 }
 if(typeof s.activeNodeId!=='string')throw new Error('焦点无效');
 return clone({...s,activeNodeId:seen.has(s.activeNodeId)?s.activeNodeId:s.rootNodeId});
}
export class PathStore {
 data:PathData={schemaVersion:1,lastSession:null,paths:[]};
 private timer:ReturnType<typeof setTimeout>|undefined;
 private queue=Promise.resolve();
 blocked=false;
 constructor(private write:(v:PathData)=>Promise<void>,private failed:(e:unknown)=>void){}
 load(raw:unknown):void {
  if(raw==null)return;
  try {
   const d=raw as PathData;if(d.schemaVersion!==1 || !Array.isArray(d.paths))throw new Error('保存数据版本无效');
   this.data={schemaVersion:1,lastSession:d.lastSession===null?null:validateSnapshot(d.lastSession),paths:d.paths.map(validateSnapshot)};
   if(new Set(this.data.paths.map(p=>p.id)).size!==this.data.paths.length)throw new Error('快照 ID 重复');
  } catch(e){this.blocked=true;this.failed(e);}
 }
 update(s:Snapshot):void {if(this.blocked)return;this.data.lastSession=validateSnapshot(s);clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},250);}
 async save(s:Snapshot):Promise<void>{if(this.blocked)throw new Error('原保存数据损坏或版本未知，已阻止覆盖');s=validateSnapshot(s);const i=this.data.paths.findIndex(p=>p.id===s.id);if(i<0)this.data.paths.push(s);else this.data.paths[i]=s;await this.flush();}
 async delete(id:string):Promise<void>{if(this.blocked)throw new Error('原保存数据不可写');this.data.paths=this.data.paths.filter(p=>p.id!==id);await this.flush();}
 async flush():Promise<void>{clearTimeout(this.timer);if(this.blocked)return;const data=clone(this.data);const next=this.queue.then(()=>this.write(data));this.queue=next.catch(e=>{this.failed(e);});return next;}
 rename(oldPath:string,newPath:string):void {
  if(this.blocked)return;
  for(const s of [this.data.lastSession,...this.data.paths])if(s)for(const n of s.nodes)if(n.filePath===oldPath || n.filePath.startsWith(oldPath+'/'))n.filePath=newPath+n.filePath.slice(oldPath.length);
  void this.flush().catch(()=>{});
 }
}
