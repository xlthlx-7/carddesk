import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {configAt,relative,cardPath,inside,scan,snapshot,readCurrent,modelHash,saveJSON,locked,qmdConfig,refresh,search,fail} from './core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let parsed;
try{parsed=parseArgs({allowPositionals:true,options:{state:{type:'string'},vault:{type:'string'},cards:{type:'string',multiple:true},exclude:{type:'string',multiple:true},model:{type:'string'},'model-sha256':{type:'string'},mode:{type:'string'},question:{type:'string'},keywords:{type:'string'},limit:{type:'string'},path:{type:'string'},'keyword-only':{type:'boolean'},'allow-keyword-fallback':{type:'boolean'}}});}
catch(e){console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'INVALID_ARGUMENT',message:e.message}}));process.exit(1);}
const {values:v,positionals}=parsed;
let state=path.resolve(v.state??path.join(root,'.carddesk-search'));
const command=positionals[0];
async function main(){
  if(Number(process.versions.node.split('.')[0])<22)fail('NODE_VERSION','检索工具需要 Node 22 或更新版本');
  if(command==='init'){
    if(!v.vault||!v.cards?.length)fail('INVALID_CONFIG','init 需要 --vault 和至少一个 --cards（可重复）；--exclude 为排除目录');
    const vault=await fs.realpath(v.vault);
    if(inside(state,vault))fail('INVALID_CONFIG','检索状态目录必须放在 Vault 之外');
    const c={schemaVersion:1,vault,allowed:[...new Set(v.cards.map(relative))].sort(),excluded:[...new Set((v.exclude??[]).map(relative))].sort(),model:path.resolve(v.model??path.join(root,'.reuse-eval/cache/qmd/models/hf_Qwen_Qwen3-Embedding-0.6B-Q8_0.gguf')),modelSha256:v['model-sha256']??'06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439'};
    await fs.mkdir(state,{recursive:true});
    state=await fs.realpath(state);
    if(inside(state,vault))fail('INVALID_CONFIG','检索状态目录必须放在 Vault 之外');
    try{await fs.access(path.join(state,'config.json'));fail('ALREADY_CONFIGURED','已有配置不会覆盖，请使用新的 --state 目录或审阅后编辑原配置');}catch(e){if(e.code!=='ENOENT')throw e;}
    await saveJSON(path.join(state,'config.json'),c);
    try{await configAt(state);await scan(c);}catch(e){await fs.rm(path.join(state,'config.json'));throw e;}
    return {operation:'init',state,vault,allowed:c.allowed,excluded:c.excluded};
  }
  try{state=await fs.realpath(state);}catch{fail('NOT_CONFIGURED','状态目录不存在，先运行 init');}
  const c=await configAt(state);
  return locked(state,async()=>{
    const current=await scan(c),snap=await snapshot(state);
    let indexPresent=true;try{await fs.access(path.join(state,'index.sqlite'));}catch{indexPresent=false;}
    if(command==='get'){
      const p=cardPath(v.path),file=await readCurrent(p,c);
      return {operation:'get',path:p,...file,indexFresh:indexPresent&&snap.keyword===current.digest,candidateOnly:true};
    }
    if(command==='status'){
      let modelProblem=null;try{await modelHash(c);}catch(e){modelProblem={code:e.code,message:e.message};}
      return {operation:'status',state,vault:c.vault,allowed:c.allowed,excluded:c.excluded,documents:Object.keys(current.files).length,indexPresent,indexFresh:indexPresent&&snap.keyword===current.digest,vectorsFresh:indexPresent&&!modelProblem&&snap.keyword===current.digest&&snap.vector===current.digest&&snap.model===c.modelSha256,model:c.model,modelProblem,updatedAt:snap.updatedAt??null};
    }
    if(!['refresh','search'].includes(command))fail('INVALID_COMMAND','命令：init/status/refresh/search/get');
    if(command==='search'&&snap.keyword!==current.digest)fail('STALE_INDEX','先运行 refresh 更新索引');
    if(command==='search'&&!indexPresent)fail('INDEX_MISSING','索引文件不存在，请 refresh 重建');
    process.env.GGML_METAL_NO_RESIDENCY='1';process.env.LLAMA_LOG_LEVEL='error';process.env.GGML_LOG_LEVEL='error';process.env.GGML_BACKEND_SILENT='1';
    process.env.XDG_CACHE_HOME=path.join(state,'cache');
    const qmdRoot=path.join(root,'.reuse-eval/qmd/node_modules/@tobilu/qmd');
    if(JSON.parse(await fs.readFile(path.join(qmdRoot,'package.json'),'utf8')).version!=='2.9.0')fail('QMD_VERSION','当前适配层仅验证 QMD 2.9.0，请按锁文件安装');
    const {createStore}=await import(pathToFileURL(path.join(qmdRoot,'dist/index.js')).href);
    const store=await createStore({dbPath:path.join(state,'index.sqlite'),config:qmdConfig(c)});
    try{
      return command==='refresh'?await refresh(store,c,state,{keywordOnly:!!v['keyword-only']}):await search(store,c,state,{mode:v.mode??'hybrid',question:v.question??'',keywords:v.keywords??'',limit:Number(v.limit??5),allowKeywordFallback:!!v['allow-keyword-fallback']});
    }finally{await store.close();}
  });
}
try{console.log(JSON.stringify({schemaVersion:1,ok:true,...await main()}));}
catch(e){console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:e.code??'QMD_FAILED',message:e.message},hint:'运行 status 检查范围；文件变动后 refresh；只在明确允许时使用 --allow-keyword-fallback。'}));process.exitCode=1;}
