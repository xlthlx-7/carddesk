import {MarkdownView, Notice, Plugin, TFile} from 'obsidian';
import {ReadingView, VIEW_TYPE} from './reading-view';
import {InstructionModal, selectPackage} from './agent-tools';
import {PathStore, Snapshot} from './path-store';
import {ask, Choose} from './path-dialogs';

export default class CarddeskPlugin extends Plugin {
 private store!:PathStore;
 async onload():Promise<void>{
  this.store=new PathStore(data=>this.saveData(data),error=>new Notice('接页保存失败（原数据未主动覆盖）：'+String(error)));
  try{this.store.load(await this.loadData());}catch(error){this.store.blocked=true;new Notice('接页无法读取保存数据：'+String(error));}
  this.registerView(VIEW_TYPE,leaf=>{
   const view=new ReadingView(leaf,s=>{
    this.app.workspace.requestSaveLayout();
    if(this.app.workspace.getActiveViewOfType(ReadingView)===view)this.store.update(s);
   });return view;
  });
  const safe=(work:()=>Promise<unknown>)=>{void work().catch(error=>new Notice('接页：'+String(error)));};
  this.addCommand({id:'open-progressive-reading',name:'以接页渐进阅读当前笔记',checkCallback:checking=>{
   const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;if(!file)return false;
   if(!checking)safe(async()=>{const view=await this.newView();await view.openRoot(file);});return true;
  }});
  this.addCommand({id:'continue-reading',name:'继续上次阅读',callback:()=>safe(async()=>{
   const s=this.store.data.lastSession;if(!s)throw new Error('还没有自动保存的阅读进度');await this.openSnapshot(s);
  })});
  this.addCommand({id:'save-reading-path',name:'保存当前阅读路径',checkCallback:checking=>{
   const view=this.app.workspace.getActiveViewOfType(ReadingView);if(!view?.snapshot())return false;
   if(!checking)safe(async()=>{
    const snapshot=view.snapshot()!;const name=await ask(this.app,'保存阅读路径名称',snapshot.name);if(!name)return;
    const old=this.store.data.paths.find(p=>p.name===name);
    if(old && await ask(this.app,'输入“覆盖”确认替换同名路径')!=='覆盖')return;
    await this.store.save({...snapshot,name,id:old?.id??crypto.randomUUID()});new Notice('阅读路径已保存');
   });return true;
  }});
  this.addCommand({id:'restore-reading-path',name:'打开已保存的阅读路径',callback:()=>{
   if(!this.store.data.paths.length){new Notice('还没有命名路径');return;}
   new Choose(this.app,this.store.data.paths,id=>safe(async()=>{const s=this.store.data.paths.find(p=>p.id===id);if(s)await this.openSnapshot(s);})).open();
  }});
  this.addCommand({id:'delete-reading-path',name:'删除已保存的阅读路径',callback:()=>{
   new Choose(this.app,this.store.data.paths,id=>safe(async()=>{
    if(await ask(this.app,'输入“删除”确认删除此阅读快照（不删除笔记）')==='删除'){await this.store.delete(id);new Notice('阅读快照已删除');}
   })).open();
  }});
  this.addCommand({id:'relink-missing-card',name:'重新关联缺失卡片',checkCallback:checking=>{
   const view=this.app.workspace.getActiveViewOfType(ReadingView);const missing=view?.missingPaths();if(!missing?.length)return false;
   if(!checking)new Choose(this.app,missing,id=>{
    new Choose(this.app,this.app.vault.getMarkdownFiles().map(f=>({id:f.path,name:f.path})),path=>safe(async()=>{
     const f=this.app.vault.getAbstractFileByPath(path);if(f instanceof TFile)await view!.relink(id,f);
    })).open();
   }).open();return true;
  }});
  this.addCommand({id:'export-agent-instructions',name:'导出 Agent 说明',callback:()=>new InstructionModal(this.app).open()});
  this.addCommand({id:'check-agent-package',name:'检查 Agent 卡片包',callback:()=>selectPackage(this.app,async path=>{const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw new Error('入口不存在');await (await this.newView()).openRoot(file);})});
  const notify=(path:string,kind:'modify'|'delete'|'rename',old?:string)=>{
   for(const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))if(leaf.view instanceof ReadingView)safe(()=>leaf.view instanceof ReadingView?leaf.view.fileChanged(path,kind,old):Promise.resolve());
  };
  this.registerEvent(this.app.metadataCache.on('changed',file=>notify(file.path,'modify')));
  this.registerEvent(this.app.metadataCache.on('resolved',()=>notify('*','modify')));
  this.registerEvent(this.app.vault.on('delete',file=>notify(file.path,'delete')));
  this.registerEvent(this.app.vault.on('rename',(file,old)=>{this.store.rename(old,file.path);notify(file.path,'rename',old);}));
  this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf?.view instanceof ReadingView){const s=leaf.view.snapshot();if(s)this.store.update(s);}}));
 }
 private async newView():Promise<ReadingView>{const leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW_TYPE,active:true});return leaf.view as ReadingView;}
 private async openSnapshot(s:Snapshot):Promise<void>{await (await this.newView()).restore(s);}
 onunload():void {this.app.workspace.detachLeavesOfType(VIEW_TYPE);void this.store.flush().catch(()=>{});}
}
