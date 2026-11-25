import split from '../resources/agent/split-cards.md';
import relations from '../resources/agent/inspect-relations.md';
import retrieval from '../resources/agent/retrieval.md';
import {safePath} from './protocol-validator';
export interface AgentConfig {sources:string;cards:string;allowed:string;excluded:string;}
export function instructions(config:AgentConfig):{path:string;text:string}[]{
 for(const value of [config.sources,config.cards,...config.allowed.split(',').map(s=>s.trim()),...config.excluded.split(',').map(s=>s.trim()).filter(Boolean)])if(!safePath(value))throw new Error('目录必须为安全的 Vault 相对路径；允许/排除范围用英文逗号分隔');
 const block=`- 原文目录：${config.sources}\n- 新卡输出根目录：${config.cards}\n- 允许检索目录：${config.allowed}\n- 排除目录：${config.excluded||'无（仍限本次用户授权范围）'}\n- 包清单目录：Carddesk/packages\n- 关联建议报告目录：Carddesk/reviews\n`;
 return [{path:'Carddesk/Agent拆卡说明.md',text:split.replace('{{CONFIG}}',block)},{path:'Carddesk/Agent关联检查说明.md',text:relations.replace('{{CONFIG}}',block)},{path:'Carddesk/Agent检索说明.md',text:retrieval.replace('{{CONFIG}}',block)}];
}
export function lineChanges(oldText:string,newText:string):string {
 const old=oldText.split('\n'),next=newText.split('\n'),changes:string[]=[];
 for(let i=0;i<Math.max(old.length,next.length);i++)if(old[i]!==next[i])changes.push(`第 ${i+1} 行\n- ${old[i]??''}\n+ ${next[i]??''}`);
 return changes.length?changes.join('\n\n'):'内容一致，无需更新。';
}
