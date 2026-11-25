import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash,scan,relative,readCurrent,candidatePath,refresh,search,locked,snapshot} from '../core.mjs';

async function fixture(t){
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'carddesk-search-')));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const vault=path.join(temp,'vault'),state=path.join(temp,'state');
  await fs.mkdir(path.join(vault,'Cards/Private'),{recursive:true});await fs.mkdir(state);
  await fs.writeFile(path.join(vault,'Cards/A.md'),'# Embedding\n\n把语义变成向量，能找不同说法的候选。');
  await fs.writeFile(path.join(vault,'Cards/Private/Secret.md'),'不可检索的内部内容');
  const c={vault,allowed:['Cards'],excluded:['Cards/Private'],model:path.join(temp,'missing.gguf'),modelSha256:'0'.repeat(64)};
  let db=new Map(),queryCalls=0;
  const store={update:async()=>{db=new Map(Object.entries((await scan(c)).files).map(([p,h])=>['qmd://cards/'+p,h]));return {};},get:async(uri)=>{const sha=db.get(uri);return sha?{hash:sha,body:await fs.readFile(path.join(vault,uri.slice('qmd://cards/'.length)),'utf8')}:{error:'not_found'};},searchLex:async()=>{queryCalls++;return [{filepath:'qmd://cards/Cards/A.md',title:'Embedding',score:1}];}};
  store.getStatus=async()=>({totalDocuments:db.size,needsEmbedding:db.size,hasVectorIndex:false});
  return {temp,vault,state,c,store,calls:()=>queryCalls};
}
test('scope rejects hidden/traversal/encoded escape, excluded notes and symlinks',async t=>{
  const {c,vault}=await fixture(t),current=await scan(c);assert.deepEqual(Object.keys(current.files),['Cards/A.md']);
  for(const p of ['../x','.obsidian/data.md','Cards//A.md','/tmp/a','Cards/../A','Cards/*.md'])assert.throws(()=>relative(p));
  await assert.rejects(readCurrent('Cards/Private/Secret.md',c),e=>e.code==='OUT_OF_SCOPE');
  assert.throws(()=>candidatePath('qmd://cards/Cards/%2e%2e/x.md',c,current.files));
  assert.throws(()=>candidatePath('qmd://other/Cards/A.md',c,current.files));
  await fs.symlink('/tmp',path.join(vault,'Cards/outside'));await assert.rejects(scan(c),e=>e.code==='SYMLINK');
});
test('content changes even with restored mtime, additions, deletions and renames reject stale search',async t=>{
  const f=await fixture(t);await refresh(f.store,f.c,f.state,{keywordOnly:true});
  const initial=await fs.stat(path.join(f.vault,'Cards/A.md'));
  for(const mutate of [async()=>{await fs.writeFile(path.join(f.vault,'Cards/A.md'),'changed');await fs.utimes(path.join(f.vault,'Cards/A.md'),initial.atime,initial.mtime);},async()=>fs.writeFile(path.join(f.vault,'Cards/B.md'),'new'),async()=>fs.rename(path.join(f.vault,'Cards/B.md'),path.join(f.vault,'Cards/C.md')),async()=>fs.rm(path.join(f.vault,'Cards/C.md'))]){
    await mutate();await assert.rejects(search(f.store,f.c,f.state,{mode:'keyword',keywords:'Embedding'}),e=>e.code==='STALE_INDEX');await refresh(f.store,f.c,f.state,{keywordOnly:true});
  }
  const hit=await search(f.store,f.c,f.state,{mode:'keyword',keywords:'Embedding'});assert.equal(hit.results[0].sha256,hash('changed'));
});
test('missing model never silently degrades; explicit fallback records actual mode and reason',async t=>{
  const f=await fixture(t);await refresh(f.store,f.c,f.state,{keywordOnly:true});
  const q={mode:'hybrid',question:'什么是语义向量',keywords:'Embedding'};
  await assert.rejects(search(f.store,f.c,f.state,q),e=>e.code==='MODEL_MISSING');assert.equal(f.calls(),0);
  const r=await search(f.store,f.c,f.state,{...q,allowKeywordFallback:true});assert.equal(r.actualMode,'keyword');assert.equal(r.requestedMode,'hybrid');assert.equal(r.fallbackReason.code,'MODEL_MISSING');assert.equal(r.candidateOnly,true);
  const vectorFallback=await search(f.store,f.c,f.state,{...q,mode:'vector',allowKeywordFallback:true});
  assert.equal(vectorFallback.actualMode,'keyword');assert.equal(vectorFallback.strategy.version,2);assert.equal(vectorFallback.fallbackReason.code,'MODEL_MISSING');
  await fs.writeFile(path.join(f.vault,'Cards/A.md'),'new');await assert.rejects(search(f.store,f.c,f.state,{...q,allowKeywordFallback:true}),e=>e.code==='STALE_INDEX');
});
test('bad indexed text, incomplete embedding and changed candidate cannot be published as fresh',async t=>{
  const f=await fixture(t);const get=f.store.get;
  f.store.get=async()=>({hash:'wrong',body:'wrong'});await assert.rejects(refresh(f.store,f.c,f.state,{keywordOnly:true}),e=>e.code==='INDEX_MISMATCH');assert.equal((await snapshot(f.state)).keyword,undefined);
  f.store.get=get;await refresh(f.store,f.c,f.state,{keywordOnly:true});
  f.c.model=path.join(f.temp,'fake-model');await fs.writeFile(f.c.model,'model');f.c.modelSha256=hash('model');f.store.embed=async()=>({errors:1});f.store.getStatus=async()=>({totalDocuments:1,needsEmbedding:1,hasVectorIndex:true});
  await assert.rejects(refresh(f.store,f.c,f.state),e=>e.code==='VECTOR_NOT_READY');assert.equal((await snapshot(f.state)).vector,null);assert.ok((await snapshot(f.state)).keyword);
  f.store.searchLex=async()=>{await fs.writeFile(path.join(f.vault,'Cards/A.md'),'changed while searching');return [{filepath:'qmd://cards/Cards/A.md'}];};
  await assert.rejects(search(f.store,f.c,f.state,{mode:'keyword',keywords:'Embedding'}),e=>e.code==='STALE_INDEX');
});
test('operation lock rejects concurrency and is released on failure',async t=>{
  const {state}=await fixture(t);
  await assert.rejects(locked(state,async()=>{await assert.rejects(locked(state,async()=>{}),e=>e.code==='BUSY');throw Error('failure');}));
  assert.equal(await locked(state,async()=>42),42);
});
test('weight identity forces same-path model changes, survives keyword-only and invalidates failed runs',async t=>{
  const f=await fixture(t),calls=[];
  f.c.model=path.join(f.temp,'weights.gguf');
  await fs.writeFile(f.c.model,'model-a');f.c.modelSha256=hash('model-a');
  f.store.embed=async opts=>{calls.push(opts);return {errors:0};};
  const status=f.store.getStatus;f.store.getStatus=async()=>({...await status(),needsEmbedding:0,hasVectorIndex:true});
  await refresh(f.store,f.c,f.state);assert.equal(calls.at(-1).force,true);
  await refresh(f.store,f.c,f.state);assert.equal(calls.at(-1).force,false);
  await fs.writeFile(f.c.model,'model-b');f.c.modelSha256=hash('model-b');
  await refresh(f.store,f.c,f.state,{keywordOnly:true});
  await refresh(f.store,f.c,f.state);assert.equal(calls.at(-1).force,true);
  await refresh(f.store,f.c,f.state);assert.equal(calls.at(-1).force,false);
  f.store.embed=async()=>{throw Error('backend failed');};
  await assert.rejects(refresh(f.store,f.c,f.state),/backend failed/);
  assert.equal((await snapshot(f.state)).vector,null);
  f.store.embed=async opts=>{calls.push(opts);return {errors:0};};
  await refresh(f.store,f.c,f.state);assert.equal(calls.at(-1).force,true);
  assert.equal((await snapshot(f.state)).model,hash('model-b'));
});
test('actual QMD SDK: scoped Unicode/space paths, fresh body, structured errors and stale guard',async t=>{
  const f=await fixture(t),cli=path.resolve('search/cli.mjs');
  await fs.writeFile(path.join(f.vault,'Cards/中文 note.md'),'# uniqueSDKprobe\n\n真实中文与空格路径。');
  await fs.mkdir(path.join(f.vault,'Cards/概念,示例'));
  await fs.writeFile(path.join(f.vault,'Cards/概念,示例/语义,关联.md'),'# uniqueCommaProbe\n\n逗号是文件名，不是目录模式。');
  const note=path.join(f.vault,'Cards/中文 note.md'),oldTime=new Date('2020-01-01T00:00:00Z');
  await fs.utimes(note,oldTime,oldTime);
  function run(...args){const r=spawnSync(process.execPath,[cli,...args,'--state',f.state],{encoding:'utf8',timeout:30000});assert.ok(!r.error,String(r.error));return JSON.parse(r.stdout);}
  assert.equal(run('init','--vault',f.vault,'--cards','Cards','--exclude','Cards/Private','--model',f.c.model).ok,true);
  assert.equal(run('refresh','--keyword-only').ok,true);
  const result=run('search','--mode','keyword','--keywords','uniqueSDKprobe');assert.equal(result.ok,true);assert.equal(result.results[0].path,'Cards/中文 note.md');
  const sparse=run('search','--mode','keyword','--keywords','uniqueSDKprobe 不存在的关键词');
  assert.equal(sparse.results[0].path,'Cards/中文 note.md');assert.equal(sparse.strategy.version,2);
  assert.deepEqual(run('search','--mode','keyword','--keywords','不可检索的内部内容').results,[]);
  assert.equal(run('search','--mode','hybrid','--question','different words','--keywords','uniqueSDKprobe').error.code,'MODEL_MISSING');
  const fallback=run('search','--mode','hybrid','--question','different words','--keywords','uniqueSDKprobe','--allow-keyword-fallback');assert.equal(fallback.actualMode,'keyword');assert.equal(fallback.fallbackReason.code,'MODEL_MISSING');
  const body=run('get','--path',result.results[0].path);assert.ok(body.body.includes('真实中文'));assert.equal(body.sha256,result.results[0].sha256);
  assert.equal(run('search','--mode','keyword','--keywords','uniqueCommaProbe').results[0].path,'Cards/概念,示例/语义,关联.md');
  assert.ok(run('get','--path','Cards/概念,示例/语义,关联.md').body.includes('逗号是文件名'));
  const previousSize=(await fs.stat(note)).size;
  await fs.writeFile(note,'# uniqueSDKprobe\n\n新的中文与空格路径。');await fs.utimes(note,oldTime,oldTime);
  assert.equal((await fs.stat(note)).size,previousSize);
  const repaired=run('refresh','--keyword-only');assert.equal(repaired.ok,true,JSON.stringify(repaired));assert.equal(repaired.reindexed,true);
  assert.equal((await fs.stat(note)).mtimeMs,oldTime.getTime());
  assert.ok(run('get','--path','Cards/中文 note.md').body.includes('新的中文'));
  assert.equal(run('search','--mode','keyword','--keywords','uniqueSDKprobe').ok,true);
  const again=run('refresh','--keyword-only');assert.equal(again.ok,true);assert.equal(again.reindexed,false);
  assert.equal(run('get','--path','Cards/Private/Secret.md').error.code,'OUT_OF_SCOPE');
  await fs.writeFile(path.join(f.vault,'Cards/中文 note.md'),'changed');assert.equal(run('search','--mode','keyword','--keywords','uniqueSDKprobe').error.code,'STALE_INDEX');assert.equal(run('get','--path','Cards/中文 note.md').indexFresh,false);
  const invalid=spawnSync(process.execPath,[cli,'--unknown'],{encoding:'utf8'});assert.equal(JSON.parse(invalid.stdout).error.code,'INVALID_ARGUMENT');assert.notEqual(invalid.status,0);
  await fs.rename(path.join(f.state,'index.sqlite'),path.join(f.state,'index.backup'));
  // File changes remain the first error; refresh restores the content snapshot.
  assert.equal(run('refresh','--keyword-only').ok,true);
  await fs.rm(path.join(f.state,'index.sqlite'));assert.equal(run('search','--mode','keyword','--keywords','uniqueSDKprobe').error.code,'INDEX_MISSING');
});

test('bounded keyword union tolerates absent terms and ranks document scope above tool scope',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.vault,'Cards/A.md'),'---\nnote: 缺词\n---\n# 文档权限\n\n文档检索应先按权限过滤，再将资料送给生成模型。');
  await fs.writeFile(path.join(f.vault,'Cards/B.md'),'# 工具权限\n\n工具执行需要权限校验和确认；不能触发未授权动作。');
  await refresh(f.store,f.c,f.state,{keywordOnly:true});
  const queries=[];
  f.store.searchLex=async(q)=>{queries.push(q);return q.includes(' ')?[]:q==='权限'?[{filepath:'qmd://cards/Cards/B.md'},{filepath:'qmd://cards/Cards/A.md'}]:['文档','过滤'].includes(q)?[{filepath:'qmd://cards/Cards/A.md'}]:[];};
  const result=await search(f.store,f.c,f.state,{mode:'keyword',keywords:'文档 权限 过滤 缺词',limit:1});
  assert.equal(result.results[0].path,'Cards/A.md');assert.equal(result.strategy.version,2);
  assert.deepEqual(result.results[0].trace.coverage.matched,['文档','权限','过滤']);
  assert.equal(queries.length,5);assert.equal(result.results.length,1);
  queries.length=0;
  await search(f.store,f.c,f.state,{mode:'keyword',keywords:'"文档 权限" -工具'});
  assert.deepEqual(queries,['"文档 权限" -工具']);
  await assert.rejects(search(f.store,f.c,f.state,{mode:'keyword',keywords:'a b c d e f g h i'}),e=>e.code==='INVALID_QUERY');
  f.store.searchLex=async()=>[{filepath:'qmd://cards/Cards/Private/Secret.md'}];
  await assert.rejects(search(f.store,f.c,f.state,{mode:'keyword',keywords:'文档 权限'}),e=>e.code==='OUT_OF_SCOPE');
});

test('hybrid fuses broad lexical evidence without changing pure vector order',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.vault,'Cards/A.md'),'# 文档授权过滤\n文档检索前按授权过滤，再提供可见资料。');
  await fs.writeFile(path.join(f.vault,'Cards/B.md'),'# 工具执行\n工具需要权限与确认。');
  f.c.model=path.join(f.temp,'model');await fs.writeFile(f.c.model,'model');f.c.modelSha256=hash('model');
  f.store.embed=async()=>({errors:0});const health=f.store.getStatus;
  f.store.getStatus=async()=>({...await health(),needsEmbedding:0,hasVectorIndex:true});
  await refresh(f.store,f.c,f.state);
  f.store.search=async()=>[{file:'qmd://cards/Cards/B.md',score:0.9},{file:'qmd://cards/Cards/A.md',score:0.7}];
  f.store.searchLex=async q=>q.includes(' ')?[]:[{filepath:'qmd://cards/Cards/A.md',score:4}];
  const q={question:'如何限制文档的访问范围',keywords:'文档 授权 过滤'};
  const mixed=await search(f.store,f.c,f.state,{...q,mode:'hybrid',limit:1});
  assert.equal(mixed.actualMode,'hybrid');assert.equal(mixed.results[0].path,'Cards/A.md');assert.ok(mixed.results[0].trace.branches.some(b=>b.name==='vec'));
  const vector=await search(f.store,f.c,f.state,{...q,mode:'vector',limit:1});
  assert.equal(vector.results[0].path,'Cards/B.md');assert.equal(vector.strategy.kind,'vector');
});
