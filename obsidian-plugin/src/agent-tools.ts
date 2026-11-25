import {App, Modal, Notice, TFile, TFolder} from 'obsidian';
import {AgentConfig, instructions, lineChanges} from './agent-instructions';
import {CardInfo, Manifest, validatePackage, Validation} from './protocol-validator';
import {Choose} from './path-dialogs';

async function folders(app:App,path:string):Promise<void>{
 const parts=path.split('/');parts.pop();let current='';
 for(const part of parts){current=current?current+'/'+part:part;const item=app.vault.getAbstractFileByPath(current);if(!item)await app.vault.createFolder(current);else if(!(item instanceof TFolder))throw new Error(`目录被文件占用：${current}`);}
}
export async function exportNew(app:App,draft:{path:string;text:string}):Promise<string>{
 const original=app.vault.getAbstractFileByPath(draft.path);
 if(original instanceof TFile && await app.vault.read(original)===draft.text)return draft.path;
 let path=draft.path;
 if(original){
  const version=draft.text.match(/^instruction_version: (\d+)$/m)?.[1]??'1';
  const prefix=draft.path.replace(/\.md$/,`.v${version}-`);
  const versions=app.vault.getFiles().filter(file=>file.path.startsWith(prefix)&&/^[1-9]\d*\.md$/.test(file.path.slice(prefix.length))).sort((a,b)=>Number(a.path.slice(prefix.length,-3))-Number(b.path.slice(prefix.length,-3)));
  for(const file of versions)if(await app.vault.read(file)===draft.text)return file.path;
  let n=1;do{path=prefix+(n++)+'.md';}while(app.vault.getAbstractFileByPath(path));
 }
 await folders(app,path);
 // create (never modify) fails safely if another writer creates this path meanwhile.
 await app.vault.create(path,draft.text);return path;
}
export class InstructionModal extends Modal {
 private config:AgentConfig={sources:'Sources',cards:'Cards',allowed:'Cards',excluded:''};
 constructor(app:App){super(app);}
 onOpen(){
  this.contentEl.createEl('h2',{text:'导出 Agent 说明'});
  this.contentEl.createEl('p',{text:'配置 Vault 相对目录，先预览再导出；仅生成说明文件，不运行 Agent。'});
  for(const [key,label] of [['sources','原文目录'],['cards','新卡输出根目录'],['allowed','允许检索目录（英文逗号分隔）'],['excluded','排除目录（可留空）']] as const){
   const row=this.contentEl.createEl('label');row.createEl('p',{text:label});const input=row.createEl('input',{type:'text',value:this.config[key]});input.style.width='100%';input.oninput=()=>{this.config[key]=input.value.trim();};
  }
  this.contentEl.createEl('button',{text:'预览导出内容'}).onclick=()=>{try{new InstructionPreview(this.app,instructions(this.config)).open();this.close();}catch(e){new Notice(String(e));}};
 }
 onClose(){this.contentEl.empty();}
}
class InstructionPreview extends Modal {
 constructor(app:App,private drafts:{path:string;text:string}[]){super(app);}
 async onOpen(){
  this.contentEl.createEl('h2',{text:'预览 Agent 说明'});
  this.contentEl.createEl('p',{text:'已有说明若内容不同，将另存版本；不会覆盖你的修改。版本号见说明头部。'});
  for(const draft of this.drafts){
   const detail=this.contentEl.createEl('details');detail.createEl('summary',{text:draft.path});
   detail.createEl('pre',{text:draft.text}).style.whiteSpace='pre-wrap';
   const old=this.app.vault.getAbstractFileByPath(draft.path);
   if(old instanceof TFile){const previous=await this.app.vault.read(old);detail.createEl('h3',{text:'与已有说明的逐行差异'});detail.createEl('pre',{text:lineChanges(previous,draft.text)}).style.whiteSpace='pre-wrap';}
  }
  const button=this.contentEl.createEl('button',{text:'确认导出三份说明'});
  button.onclick=async()=>{button.disabled=true;const paths:string[]=[];try{
   for(const draft of this.drafts)paths.push(await exportNew(this.app,draft));
   new Notice('已导出：'+paths.join('、'));this.contentEl.createEl('p',{text:'把这些路径告诉本地 Agent：'+paths.join('、')});button.setText('已导出');
  }catch(e){new Notice('导出未完成：'+String(e)+(paths.length?'；已创建 '+paths.join('、'):''));button.disabled=false;}};
 }
 onClose(){this.contentEl.empty();}
}

export async function checkPackage(app:App,file:TFile):Promise<Validation>{
 if(file.stat.size>1024*1024)throw new Error('manifest 超过 1 MB');
 const manifest=JSON.parse(await app.vault.read(file));
 const idIndex=new Map<string,string[]>();
 for(const f of app.vault.getMarkdownFiles()){
  const id=app.metadataCache.getFileCache(f)?.frontmatter?.card_id;
  if(typeof id==='string')idIndex.set(id,[...(idIndex.get(id)??[]),f.path]);
 }
 const result=await validatePackage(manifest,{
  exists:path=>app.vault.getAbstractFileByPath(path) instanceof TFile,
  idPaths:id=>idIndex.get(id)??[],
  readCard:async path=>{
   const f=app.vault.getAbstractFileByPath(path);if(!(f instanceof TFile))throw new Error('文件不存在');
   const cache=app.metadataCache.getFileCache(f);if(!cache)throw new Error('元数据尚未就绪，请稍后重新检查');
   if(f.stat.size>1024*1024)throw new Error('卡片超过 1 MB');
   const before=f.stat.mtime,text=await app.vault.read(f);
   if(before!==f.stat.mtime)throw new Error('校验期间文件变更，请重试');
   const links:CardInfo['links']=[];
   for(const [refs,embedded] of [[cache.links??[],false],[cache.embeds??[],true]] as const)for(const ref of refs){
    if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.link))continue;
    const target=app.metadataCache.getFirstLinkpathDest(ref.link.split('#')[0]||f.path,f.path);
    links.push({link:ref.link,target:target?.path??null,markdown:target?.extension==='md',fragment:ref.link.includes('#'),embedded});
   }
   return {frontmatter:cache.frontmatter??{},body:cache.frontmatterPosition?text.slice(cache.frontmatterPosition.end.offset):text,links};
  }
 });return result;
}
export class PackageReport extends Modal {
 constructor(app:App,private file:TFile,private result:Validation,private openEntry:(path:string)=>Promise<void>){super(app);}
 onOpen(){
  const errors=this.result.issues.filter(i=>i.level==='error').length,warnings=this.result.issues.length-errors;
  this.contentEl.createEl('h2',{text:'卡片包校验结果'});
  this.contentEl.createEl('p',{text:`${this.file.path}：${errors} 个错误，${warnings} 个警告。只读校验，不修改任何卡片。`});
  for(const issue of this.result.issues){const row=this.contentEl.createEl('p');row.createEl('strong',{text:issue.level==='error'?'错误 · ':'警告 · '});
   const file=this.app.vault.getAbstractFileByPath(issue.path);
   if(file instanceof TFile){const button=row.createEl('button',{text:issue.path});button.onclick=()=>{void this.app.workspace.openLinkText(file.path,'',true);};}else row.createEl('span',{text:issue.path});
   row.createEl('span',{text:' — '+issue.message});
  }
  if(!errors && this.result.manifest){const entry=this.result.manifest.entry;this.contentEl.createEl('button',{text:'以接页打开入口'}).onclick=()=>{void this.openEntry(entry).catch(e=>new Notice(String(e)));this.close();};}
 }
 onClose(){this.contentEl.empty();}
}
export function selectPackage(app:App,openEntry:(path:string)=>Promise<void>):void {
 const files=app.vault.getFiles().filter(f=>f.extension==='json'&&f.path.startsWith('Carddesk/packages/'));
 if(!files.length){new Notice('请先将 manifest 放到 Carddesk/packages/');return;}
 new Choose(app,files.map(f=>({id:f.path,name:f.path})),path=>{void(async()=>{
  const f=app.vault.getAbstractFileByPath(path);if(!(f instanceof TFile))throw new Error('清单已不存在');
  const result=await checkPackage(app,f);new PackageReport(app,f,result,openEntry).open();
 })().catch(e=>new Notice('校验失败：'+String(e)));},'选择卡片包 manifest').open();
}
