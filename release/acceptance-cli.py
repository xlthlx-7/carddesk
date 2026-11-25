"""Local P4 installation/offline/failure checks, not semantic or scale evaluation."""
from pathlib import Path
import json,subprocess,hashlib,shutil,datetime
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'docs/validation/p4';FRESH=ROOT/'.reuse-eval/p4/fresh install 0.3.4'
TOOLS=FRESH/'carddesk-tools-0.3.4';VAULT=FRESH/'Carddesk示例库';STATE=ROOT/'.reuse-eval/p4/final-fresh-state';MISSING=ROOT/'.reuse-eval/p4/final-missing-model-state'
MODEL=ROOT/'.reuse-eval/cache/qmd/models/hf_Qwen_Qwen3-Embedding-0.6B-Q8_0.gguf';NODE='/usr/local/bin/node'
SHA='06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439'
def run(label,args,state=STATE,ok=True,code=None):
 cmd=['/usr/bin/sandbox-exec','-p','(version 1)(allow default)(deny network*)',NODE,str(TOOLS/'search/cli.mjs'),*args,'--state',str(state)]
 r=subprocess.run(cmd,cwd=TOOLS,capture_output=True,text=True,timeout=180)
 (OUT/(label+'.stderr.log')).write_text(r.stderr)
 a=json.loads(r.stdout);(OUT/(label+'.json')).write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
 assert a['ok']==ok,(label,a,r.stderr)
 assert (r.returncode==0)==ok,(label,r.returncode)
 if code:assert a['error']['code']==code,(label,a)
 print(label,a.get('actualMode',a.get('operation',a.get('error'))),flush=True)
 return a

def main():
 assert not STATE.exists() and not MISSING.exists(),'Do not overwrite existing P4 state; archive and retry explicitly'
 initial={str(p.relative_to(VAULT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in VAULT.rglob('*') if p.is_file()}
 init=['init','--vault',str(VAULT),'--cards','Cards/P3','--model',str(MODEL),'--model-sha256',SHA]
 run('fresh-init',init)
 run('fresh-init-repeat',init,ok=False,code='ALREADY_CONFIGURED')
 run('offline-keyword-refresh',['refresh','--keyword-only'])
 k=run('offline-keyword',['search','--mode','keyword','--keywords','来源 关联','--limit','5']);assert k['results']
 run('offline-full-refresh',['refresh'])
 vector=run('offline-vector',['search','--mode','vector','--question','怎样把已有知识放在需要时再展开？','--limit','5']);assert vector['results']
 mixed=run('offline-hybrid',['search','--mode','hybrid','--question','为什么保留原文和关联都需要检查？','--keywords','来源 关联','--limit','5']);assert mixed['actualMode']=='hybrid' and mixed['results']
 body=run('offline-get',['get','--path',mixed['results'][0]['path']]);assert body['indexFresh'] and body['body']
 run('offline-status',['status'])
 run('missing-init',['init','--vault',str(VAULT),'--cards','Cards/P3','--model',str(ROOT/'.reuse-eval/p4/model-not-installed.gguf'),'--model-sha256',SHA],state=MISSING)
 run('missing-keyword-refresh',['refresh','--keyword-only'],state=MISSING)
 run('missing-model-fails',['search','--mode','hybrid','--question','怎样保留来源？','--keywords','来源'],state=MISSING,ok=False,code='MODEL_MISSING')
 fallback=run('missing-model-fallback',['search','--mode','hybrid','--question','怎样保留来源？','--keywords','来源','--allow-keyword-fallback'],state=MISSING);assert fallback['actualMode']=='keyword' and fallback['fallbackReason']['code']=='MODEL_MISSING'
 # Actual corrupt derived DB, no mutations to Vault or model.
 q=ROOT/'.reuse-eval/p4/final-quarantine-corrupt';q.mkdir()
 shutil.copy2(STATE/'index.sqlite',q/'index-original.sqlite')
 (STATE/'index.sqlite').write_bytes(b'P4 intentionally corrupt derived index\n')
 corrupt=run('corrupt-index-fails',['search','--mode','keyword','--keywords','来源'],ok=False)
 assert corrupt['error']['code'] in {'QMD_FAILED','SQLITE_NOTADB','SQLITE_CORRUPT'}
 for n in ['index.sqlite','index.sqlite-wal','index.sqlite-shm','snapshot.json','embedding-model.json']:
  f=STATE/n
  if f.exists():shutil.move(f,q/n)
 run('corrupt-index-rebuild',['refresh'])
 run('recovered-query',['search','--mode','keyword','--keywords','来源'])
 # A throwaway Markdown note exercises fresh-install stale/rename/delete handling.
 f=VAULT/'Cards/P3/P4-probe.md';f.write_text('# P4uniqueprobe\n\n仅在隔离库临时存在。\n')
 run('new-file-stale',['search','--mode','keyword','--keywords','P4uniqueprobe'],ok=False,code='STALE_INDEX')
 run('new-file-update',['refresh','--keyword-only'])
 assert run('new-file-query',['search','--mode','keyword','--keywords','P4uniqueprobe'])['results'][0]['path']=='Cards/P3/P4-probe.md'
 f.rename(f.with_name('P4-renamed.md'))
 run('rename-stale',['search','--mode','keyword','--keywords','P4uniqueprobe'],ok=False,code='STALE_INDEX')
 run('rename-update',['refresh','--keyword-only'])
 assert run('rename-query',['search','--mode','keyword','--keywords','P4uniqueprobe'])['results'][0]['path']=='Cards/P3/P4-renamed.md'
 # Test-only note moved to backup, not permanently removed.
 shutil.move(VAULT/'Cards/P3/P4-renamed.md',ROOT/'.reuse-eval/p4/final-P4-renamed-backup.md')
 run('delete-stale',['search','--mode','keyword','--keywords','P4uniqueprobe'],ok=False,code='STALE_INDEX')
 run('delete-update',['refresh'])
 assert not run('deleted-query',['search','--mode','keyword','--keywords','P4uniqueprobe'])['results']
 final={str(p.relative_to(VAULT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in VAULT.rglob('*') if p.is_file()}
 assert initial==final
 (OUT/'cli-summary.json').write_text(json.dumps({'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freshDependencyInstall':True,'networkProfile':'(version 1)(allow default)(deny network*)','model':'pre-provisioned official local file via --model; no model in release ZIP','vaultUnchanged':True,'offlineKeywordVectorHybrid':True,'modelMissingExplicitFallback':True,'corruptIndexRecovered':True,'incrementalCreateRenameDelete':True,'obsidian':'quit through native menu before this run'},ensure_ascii=False,indent=2)+'\n')
 print('P4 CLI acceptance passed',flush=True)
if __name__=='__main__':main()
