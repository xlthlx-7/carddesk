import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {keywordPlan,coverage,fuse} from './query-strategy.mjs';

export class SearchError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
export const fail=(code,message)=>{throw new SearchError(code,message);};
export const hash=text=>createHash('sha256').update(text).digest('hex');
export const inside=(p,root)=>p===root||p.startsWith(root+'/');
export function relative(value){
  if(typeof value!=='string'||!value||value.includes('\\')||/[\x00-\x1f:*?{},\[\]#^|!]/.test(value)||path.posix.isAbsolute(value)||value.split('/').some(s=>!s||s==='..'||s==='.'||s.startsWith('.')))
    fail('INVALID_PATH','需要普通的 Vault 相对目录或 Markdown 路径，不含隐藏目录、通配符或 ..');
  return value;
}
// Directory configuration becomes a glob; actual card paths are literal names.
export function cardPath(value){
  if(typeof value!=='string'||!value||/[\x00-\x1f\\:\[\]#^|]/.test(value)||path.posix.isAbsolute(value)||value.split('/').some(s=>!s||s==='..'||s==='.'||s.startsWith('.')))
    fail('INVALID_PATH','需要 Vault 内的普通卡片路径，不含隐藏目录、链接定位符或 ..');
  return value;
}
const ignored=new Set(['node_modules','vendor','dist','build']);
export async function configAt(state){
  let c;
  try{c=JSON.parse(await fs.readFile(path.join(state,'config.json'),'utf8'));}
  catch{fail('NOT_CONFIGURED','先运行 init，或检查 config.json 是否损坏');}
  if(c.schemaVersion!==1||!Array.isArray(c.allowed)||!c.allowed.length||!Array.isArray(c.excluded)||!path.isAbsolute(c.vault)||!path.isAbsolute(c.model)||!/^[a-f0-9]{64}$/.test(c.modelSha256??''))fail('INVALID_CONFIG','配置格式或版本不支持');
  c.allowed.forEach(relative);c.excluded.forEach(relative);
  if(await fs.realpath(state)!==state||inside(state,c.vault))fail('INVALID_CONFIG','状态目录必须位于 Vault 外，且不得经过符号链接');
  if(await fs.realpath(c.vault)!==c.vault)fail('VAULT_MOVED','Vault 路径已变化，请重新初始化检索配置');
  for(const dir of c.allowed){
    const p=path.join(c.vault,dir);
    if(await fs.realpath(p)!==p)fail('SYMLINK','允许目录不得经过符号链接');
    if(!(await fs.stat(p)).isDirectory())fail('INVALID_CONFIG','允许范围必须为目录');
  }
  return c;
}
export function permitted(p,c){
  cardPath(p);
  return p.endsWith('.md')&&c.allowed.some(d=>inside(p,d))&&!c.excluded.some(d=>inside(p,d))&&!p.split('/').some(x=>ignored.has(x));
}
export async function readCurrent(p,c){
  if(!permitted(p,c))fail('OUT_OF_SCOPE','路径不在允许检索范围，或属于排除目录');
  const full=path.join(c.vault,p);
  let real;
  try{real=await fs.realpath(full);}catch{fail('MISSING_FILE','卡片不存在，先刷新索引');}
  if(real!==full)fail('SYMLINK','卡片路径不得经过符号链接');
  const before=await fs.stat(full);
  if(!before.isFile()||before.size>1024*1024)fail('CARD_TOO_LARGE','只支持不超过 1 MiB 的 Markdown 卡片');
  const body=await fs.readFile(full,'utf8'),after=await fs.stat(full);
  if(before.mtimeMs!==after.mtimeMs||before.size!==after.size)fail('FILES_CHANGED','读取过程中卡片变化，请重试');
  return {body,sha256:hash(body)};
}
export async function scan(c){
  const names=new Set();
  async function walk(dir){
    for(const item of await fs.readdir(path.join(c.vault,dir),{withFileTypes:true})){
      if(item.name.startsWith('.')||ignored.has(item.name))continue;
      const p=dir+'/'+item.name;
      if(c.excluded.some(x=>inside(p,x)))continue;
      if(item.isSymbolicLink())fail('SYMLINK','检索范围内含符号链接，请移出范围或显式排除');
      if(item.isDirectory())await walk(p);
      else if(item.isFile()&&p.endsWith('.md'))names.add(p);
    }
  }
  for(const dir of c.allowed)await walk(dir);
  const files={};
  // Bounded reads keep a large Vault from opening thousands of files at once.
  const list=[...names].sort();
  for(let i=0;i<list.length;i+=32){
    for(const [p,v] of await Promise.all(list.slice(i,i+32).map(async p=>[p,await readCurrent(p,c)])))files[p]=v.sha256;
  }
  const digest=hash(JSON.stringify({vault:c.vault,allowed:c.allowed,excluded:c.excluded,files}));
  return {digest,files};
}
export function candidatePath(uri,c,files){
  const prefix='qmd://cards/';
  if(typeof uri!=='string'||!uri.startsWith(prefix))fail('INVALID_RESULT','QMD 返回未知集合');
  const raw=uri.slice(prefix.length);let decoded;
  try{decoded=decodeURIComponent(raw);}catch{decoded=raw;}
  cardPath(raw);cardPath(decoded);
  if(raw!==decoded&&files[raw]&&files[decoded])fail('AMBIGUOUS_PATH','QMD 地址存在编码歧义');
  const p=files[raw]?raw:decoded;
  if(!files[p]||!permitted(p,c))fail('OUT_OF_SCOPE','QMD 候选不在当前允许文件集合');
  return p;
}
export async function modelHash(c){
  try{
    const sum=createHash('sha256');
    for await(const chunk of createReadStream(c.model))sum.update(chunk);
    if(sum.digest('hex')!==c.modelSha256)fail('MODEL_INVALID','嵌入模型哈希不匹配');
    return c.modelSha256;
  }catch(e){if(e instanceof SearchError)throw e;fail('MODEL_MISSING','本地嵌入模型不可读取；按手册准备模型');}
}
export async function saveJSON(file,value){
  const temp=file+'.'+process.pid+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,file);}
  finally{await fs.rm(temp,{force:true});}
}
export async function snapshot(state){try{return JSON.parse(await fs.readFile(path.join(state,'snapshot.json'),'utf8'));}catch{return {};}}
export async function locked(state,fn){
  const lock=path.join(state,'operation.lock');
  try{await fs.mkdir(lock);}catch{fail('BUSY','另一个检索操作正在运行；若进程已异常退出，确认无操作后移走 operation.lock 再重试');}
  try{await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}));return await fn();}
  finally{await fs.rm(lock,{recursive:true,force:true});}
}
export function qmdConfig(c){
  const patterns=c.allowed.map(d=>d+'/**/*.md');
  return {collections:{cards:{path:c.vault,pattern:patterns.length===1?patterns[0]:'{'+patterns.join(',')+'}',ignore:c.excluded.flatMap(d=>[d,d+'/**'])}},models:{embed:c.model}};
}
export async function refresh(store,c,state,{keywordOnly=false}={}){
  const before=await scan(c);
  await saveJSON(path.join(state,'snapshot.json'),{});
  let update=await store.update(),reindexed=false;
  // Compare actual QMD indexed text, not just our own scan manifest.
  async function mismatch(){
    for(const [p,sha] of Object.entries(before.files)){
      const doc=await store.get('qmd://cards/'+p,{includeBody:true});
      if(doc.error||doc.hash!==sha||hash(doc.body??'')!==sha)return p;
    }
    return null;
  }
  let different=await mismatch();
  if(different){
    if((await scan(c)).digest!==before.digest)fail('FILES_CHANGED','刷新期间卡片变化，请重新刷新');
    if(typeof store.removeCollection!=='function'||typeof store.addCollection!=='function')fail('INDEX_MISMATCH','QMD 未正确收录卡片：'+different);
    // QMD's mtime/size fast path can miss restored timestamps. Recreate only
    // this derived collection via public APIs, without touching Vault files.
    await store.removeCollection('cards');
    await store.addCollection('cards',qmdConfig(c).collections.cards);
    update=await store.update();reindexed=true;
    different=await mismatch();
    if(different)fail('INDEX_MISMATCH','重建后 QMD 仍未正确收录卡片：'+different);
  }
  if((await scan(c)).digest!==before.digest)fail('FILES_CHANGED','刷新期间卡片变化，请重新刷新');
  const snap={schemaVersion:1,keyword:before.digest,files:before.files,vector:null,model:null,updatedAt:new Date().toISOString()};
  await saveJSON(path.join(state,'snapshot.json'),snap);
  let embed=null;
  if(!keywordOnly){
    const model=await modelHash(c);
    const identityFile=path.join(state,'embedding-model.json');
    let identity;try{identity=JSON.parse(await fs.readFile(identityFile,'utf8'));}catch{}
    const force=identity?.schemaVersion!==1||identity?.ready!==true||identity?.sha256!==model||identity?.path!==c.model;
    // Persist invalidation before calling the backend, including crash/retry.
    await saveJSON(identityFile,{schemaVersion:1,ready:false});
    try{
      embed=await store.embed({model:c.model,force});
      const status=await store.getStatus();
      if(embed.errors||status.needsEmbedding||!status.hasVectorIndex)fail('VECTOR_NOT_READY','向量尚未完成；可显式允许关键词回退');
      if((await scan(c)).digest!==before.digest)fail('FILES_CHANGED','嵌入期间卡片变化，请重新刷新');
      await modelHash(c);
      await saveJSON(identityFile,{schemaVersion:1,ready:true,path:c.model,sha256:model});
      snap.vector=before.digest;snap.model=model;
      await saveJSON(path.join(state,'snapshot.json'),snap);
    }catch(e){
      await saveJSON(identityFile,{schemaVersion:1,ready:false});
      throw e;
    }
  }
  return {operation:'refresh',actualMode:keywordOnly?'keyword':'hybrid-ready',documents:Object.keys(before.files).length,reindexed,update,embed};
}
export async function search(store,c,state,{mode='hybrid',question='',keywords='',limit=5,allowKeywordFallback=false}={}){
  if(!['keyword','vector','hybrid'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>20)fail('INVALID_QUERY','mode 只能为 keyword/vector/hybrid；limit 为 1～20');
  if((mode!=='keyword'&&!question.trim())||(mode!=='vector'&&!keywords.trim()))fail('INVALID_QUERY','关键词模式需要 keywords，向量模式需要 question，混合模式两者都需要');
  const current=await scan(c),snap=await snapshot(state);
  if(snap.keyword!==current.digest)fail('STALE_INDEX','文件或检索范围已变化，先运行 refresh；不会使用旧索引');
  const health=await store.getStatus();
  if(health.totalDocuments!==Object.keys(current.files).length)fail('INDEX_MISMATCH','索引文档集合不完整，请 refresh');
  let actualMode=mode,fallbackReason=null;
  let plan;
  try{plan=mode==='vector'?null:keywordPlan(keywords);}catch(e){fail('INVALID_QUERY',e.message);}
  const poolLimit=40;
  async function lexical(){
    if(!plan){try{plan=keywordPlan(keywords);}catch(e){fail('INVALID_QUERY',e.message);}}
    const runs=[];
    for(const query of plan.queries)runs.push({name:'lex:'+query,weight:query===keywords.trim()?2:1,hits:await store.searchLex(query,{collection:'cards',limit:poolLimit})});
    return fuse(runs);
  }
  let hits;
  try{
    if(mode!=='keyword'){
      const model=await modelHash(c);
      if(snap.vector!==current.digest||snap.model!==model||health.needsEmbedding||!health.hasVectorIndex)fail('VECTOR_NOT_READY','当前文本尚无对应模型的完整向量，先 refresh');
    }
    if(mode==='keyword')hits=await lexical();
    else if(mode==='vector')hits=await store.search({queries:[{type:'vec',query:question}],collections:['cards'],rerank:false,limit,explain:true});
    else {
      const semantic=await store.search({queries:[{type:'vec',query:question}],collections:['cards'],rerank:false,limit:poolLimit,explain:true});
      // Lexical already contains multi-query RRF weights; add one vector branch.
      hits=await lexical();
      const byUri=new Map(hits.map(h=>[h.file??h.filepath,h]));
      for(const h of fuse([{name:'vec',weight:2,hits:semantic}])){
        const key=h.file??h.filepath,old=byUri.get(key);
        if(old){old.fusionScore+=h.fusionScore;old.branches.push(...h.branches);}else byUri.set(key,h);
      }
      hits=[...byUri.values()].sort((a,b)=>b.fusionScore-a.fusionScore);
    }
  }catch(e){
    if(mode==='keyword'||!allowKeywordFallback||!keywords.trim())throw e;
    actualMode='keyword';fallbackReason={code:e.code??'VECTOR_FAILED',message:e.message};hits=await lexical();
  }
  // Validate every backend path before bounding the full-text ranking pool.
  for(const hit of hits)candidatePath(hit.file??hit.filepath,c,current.files);
  const results=[],seen=new Set();
  const ranking=actualMode!=='vector';
  if(ranking)hits=hits.slice(0,60);
  for(const hit of hits){
    const uri=hit.file??hit.filepath,p=candidatePath(uri,c,current.files);
    if(seen.has(p))continue;seen.add(p);
    const now=await readCurrent(p,c);
    const indexed=await store.get(uri,{includeBody:true});
    if(now.sha256!==current.files[p]||indexed.error||indexed.hash!==now.sha256||hash(indexed.body??'')!==now.sha256)fail('STALE_INDEX','候选正文已变更，请刷新索引');
    const evidence=ranking?coverage(now.body,plan.terms):null;
    const score=ranking?hit.fusionScore+0.02*evidence.body+0.025*evidence.title:hit.score;
    results.push({path:p,title:hit.title,score,sha256:now.sha256,snippet:now.body.slice(0,500),link:`[[${p.slice(0,-3)}]]`,qmdUri:uri,trace:ranking?{strategy:2,branches:hit.branches,coverage:evidence,backend:hit.explain??null}:hit.explain??null});
  }
  if(ranking)results.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  if((await scan(c)).digest!==current.digest)fail('FILES_CHANGED','查询期间资料发生变化，请重试');
  return {operation:'search',requestedMode:mode,actualMode,fallbackReason,indexFresh:true,candidateOnly:true,question,keywords,strategy:ranking?{...plan,poolPerQuery:poolLimit,fullTextPool:60,ranking:'RRF + visible body/title coverage'}:{version:1,kind:'vector'},results:results.slice(0,limit)};
}
