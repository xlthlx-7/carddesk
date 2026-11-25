/** Pure validation engine. The host supplies parsed metadata, never regex wiki parsing. */
export interface Manifest {schemaVersion:1;packageId:string;title:string;entry:string;files:string[];sources:string[];}
export interface Issue {level:'error'|'warning';path:string;message:string;}
export interface CardInfo {frontmatter:Record<string,unknown>;body:string;links:{link:string;target:string|null;markdown:boolean;fragment:boolean;embedded:boolean}[];}
export interface PackageHost {exists:(path:string)=>boolean;readCard:(path:string)=>Promise<CardInfo>;idPaths:(id:string)=>string[];}
export interface Validation {manifest:Manifest|null;issues:Issue[];}
export function safePath(value:unknown):value is string {
 return typeof value==='string' && !!value && value===value.trim() && !/[\\\x00-\x1f:#|]/.test(value) && !value.startsWith('/') && value.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'&&!p.startsWith('.'));
}
export async function validatePackage(raw:unknown,host:PackageHost):Promise<Validation>{
 const issues:Issue[]=[];const add=(level:Issue['level'],path:string,message:string)=>issues.push({level,path,message});
 const m=raw as Manifest;
 if(!m || m.schemaVersion!==1 || typeof m.packageId!=='string'||!m.packageId.trim()||typeof m.title!=='string'||!m.title.trim()||!Array.isArray(m.files)||!m.files.length||m.files.length>1000||!Array.isArray(m.sources)||!m.sources.length||m.sources.length>1000||!safePath(m.entry)){
  add('error','manifest','格式无效、版本不支持或超出 1000 个文件/来源上限');return {manifest:null,issues};
 }
 if([...m.files,...m.sources].some(p=>!safePath(p))){add('error','manifest','文件/来源必须为安全的 Vault 相对路径');return {manifest:null,issues};}
 if(m.files.some(p=>!p.endsWith('.md'))){add('error','manifest','卡片必须为 .md 文件');return {manifest:null,issues};}
 if(new Set(m.files).size!==m.files.length||new Set(m.sources).size!==m.sources.length)add('error','manifest','清单包含重复文件或来源');
 if(!m.files.includes(m.entry))add('error',m.entry,'入口不在 files 中');
 for(const path of m.sources)if(!host.exists(path))add('error',path,'来源文件不存在');
 const graph=new Map<string,string[]>();
 for(const path of new Set(m.files)){
  if(!host.exists(path)){add('error',path,'卡片文件不存在');continue;}
  try{
   const card=await host.readCard(path),f=card.frontmatter;
   if(f.carddesk_schema!==1)add('error',path,'carddesk_schema 必须为 1');
   if(typeof f.card_id!=='string'||!f.card_id.trim())add('error',path,'缺少 card_id');
   else {const paths=host.idPaths(f.card_id);if(paths.length!==1||paths[0]!==path)add('error',path,`card_id 不唯一：${f.card_id}`);}
   if(!['entry','explanation','example'].includes(String(f.card_role)))add('error',path,'card_role 必须为 entry/explanation/example');
   if(path===m.entry && f.card_role!=='entry')add('warning',path,'入口建议标记为 entry');
   if(!safePath(f.source_path)||!m.sources.includes(f.source_path)||!host.exists(f.source_path))add('error',path,'source_path 无效、不在 sources 中或来源不存在');
   if(typeof f.source_locator!=='string'||!f.source_locator.trim())add('error',path,'缺少可核对的 source_locator');
   const length=Array.from(card.body.trim()).length;
   if(length<200||length>500)add('warning',path,`正文约 ${length} 字符，建议 200～500（不作硬限制）`);
   const edges:string[]=[];
   for(const link of card.links){
    if(!link.target){add('error',path,`链接目标不存在：${link.link}`);continue;}
    if(link.fragment||link.embedded)add('warning',path,`渐进阅读建议使用整卡链接：${link.link}`);
    if(link.markdown&&!link.fragment&&!link.embedded)edges.push(link.target);
   }
   graph.set(path,edges);
  }catch(e){add('error',path,'无法读取或解析卡片：'+String(e));}
 }
 const seen=new Set<string>(),stack=[m.entry];
 while(stack.length){const p=stack.pop()!;if(seen.has(p))continue;seen.add(p);for(const target of graph.get(p)??[])if(m.files.includes(target))stack.push(target);}
 for(const path of m.files)if(!seen.has(path))add('warning',path,'入口沿包内正文整卡链接无法到达，检查是否为孤立卡');
 return {manifest:m,issues};
}
