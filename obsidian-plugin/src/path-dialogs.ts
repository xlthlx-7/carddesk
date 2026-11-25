import {App, Modal, SuggestModal} from 'obsidian';
export function ask(app:App,title:string,initial=''):Promise<string|null>{return new Promise(resolve=>{
 let done=false;const modal=new class extends Modal {
 onOpen(){this.contentEl.createEl('h3',{text:title});const input=this.contentEl.createEl('input',{type:'text',value:initial});input.style.width='100%';
 const accept=()=>{const name=input.value.trim();if(name){done=true;resolve(name);this.close();}};
 input.addEventListener('keydown',e=>{if(e.key==='Enter')accept();});this.contentEl.createEl('button',{text:'确认'}).onclick=accept;input.focus();}
 onClose(){this.contentEl.empty();if(!done)resolve(null);}
 }(app);modal.open();});}
export class Choose extends SuggestModal<{id:string;name:string}>{
 constructor(app:App,private items:{id:string;name:string}[],private chosen:(id:string)=>void,placeholder='选择阅读路径'){super(app);this.setPlaceholder(placeholder);}
 getSuggestions(query:string){return this.items.filter(p=>p.name.includes(query));}
 renderSuggestion(p:{name:string},el:HTMLElement){el.setText(p.name);}
 onChooseSuggestion(p:{id:string}){this.chosen(p.id);}
}
