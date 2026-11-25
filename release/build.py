"""Build local test artifacts from explicit allowlists, never a live Vault dump."""
from pathlib import Path
import hashlib,json,zipfile,shutil
ROOT=Path(__file__).resolve().parent.parent
VERSION=json.loads((ROOT/'obsidian-plugin/manifest.json').read_text())['version']
OUT=ROOT/'dist'/f'carddesk-{VERSION}-test';OUT.mkdir(parents=True,exist_ok=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pack(name,items):
 p=OUT/name
 with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
  for source,target in sorted(items,key=lambda x:x[1]):z.write(source,target)
 return p
plugin=[(ROOT/'obsidian-plugin/dist/carddesk'/n,'carddesk/'+n) for n in ['main.js','manifest.json','styles.css']]
pack(f'carddesk-plugin-{VERSION}.zip',plugin)
tools=[]
for n in ['cli.mjs','core.mjs','query-strategy.mjs','README.md']:tools.append((ROOT/'search'/n,f'carddesk-tools-{VERSION}/search/{n}'))
for name in ['reuse-eval/qmd-dependency/package.json','reuse-eval/qmd-dependency/package-lock.json','reuse-eval/aipm/download-model.sh','release/setup-search.sh','release/verify.py','docs/AGENT_CARD_PROTOCOL.md']:
 tools.append((ROOT/name,f'carddesk-tools-{VERSION}/{name}'))
for name in ['OBSIDIAN_P4_VALIDATION.md','TODO.md']:
 p=ROOT/'docs'/name
 if p.exists():tools.append((p,f'carddesk-tools-{VERSION}/docs/{name}'))
tools.append((ROOT/'release/DELIVERY_README.md',f'carddesk-tools-{VERSION}/README.md'))
pack(f'carddesk-tools-{VERSION}.zip',tools)
fixture=ROOT/'obsidian-plugin/fixtures/vault';items=[(p,'Carddesk示例库/'+str(p.relative_to(fixture))) for p in fixture.rglob('*') if p.is_file()]
items.extend((s,'Carddesk示例库/.obsidian/plugins/'+n) for s,n in plugin)
items.append((ROOT/'release/DELIVERY_README.md','Carddesk示例库/开始使用.md'))
pack(f'carddesk-example-vault-{VERSION}.zip',items)
shutil.copy2(ROOT/'release/DELIVERY_README.md',OUT/'开始使用.md')
shutil.copy2(ROOT/'release/verify.py',OUT/'校验发布包.py')
for name in ['OBSIDIAN_P4_VALIDATION.md','TODO.md']:
 p=ROOT/'docs'/name
 if p.exists():shutil.copy2(p,OUT/name)
model={'id':'Qwen/Qwen3-Embedding-0.6B-GGUF','file':'Qwen3-Embedding-0.6B-Q8_0.gguf','bytes':639150592,'sha256':'06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439','officialUrl':'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf','weightsIncluded':False}
(OUT/'MODEL.json').write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n')
manifest={'version':VERSION,'kind':'local-test-release','acceptanceStatus':'passed-scoped-local-test','scope':'P4 install/offline/fallback/workflow; quality/scale tasks deferred by user','files':{p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in OUT.iterdir() if p.is_file() and p.name!='SHA256SUMS.json'}}
manifest['archiveContents']={}
for p in OUT.glob('*.zip'):
 with zipfile.ZipFile(p) as z:manifest['archiveContents'][p.name]={n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}
(OUT/'SHA256SUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(OUT)
