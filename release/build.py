"""Build local test artifacts from explicit allowlists, never a live Vault dump."""
from pathlib import Path
import hashlib,json,zipfile,shutil,argparse,subprocess
ROOT=Path(__file__).resolve().parent.parent
VERSION=json.loads((ROOT/'obsidian-plugin/manifest.json').read_text())['version']
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,help='Output folder; only explicit public assets enter the manifest')
parser.add_argument('--source-commit',help='Runtime source commit for a packaging-only release correction')
args=parser.parse_args()
OUT=(args.output or ROOT/'dist'/f'carddesk-{VERSION}-test').resolve();OUT.mkdir(parents=True,exist_ok=True)
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
tools.append((ROOT/'release/KNOWN_LIMITATIONS.md',f'carddesk-tools-{VERSION}/KNOWN_LIMITATIONS.md'))
tools.append((ROOT/'release/DELIVERY_README.md',f'carddesk-tools-{VERSION}/README.md'))
pack(f'carddesk-tools-{VERSION}.zip',tools)
fixture=ROOT/'obsidian-plugin/fixtures/vault';items=[(p,'Carddesk示例库/'+str(p.relative_to(fixture))) for p in fixture.rglob('*') if p.is_file()]
items.extend((s,'Carddesk示例库/.obsidian/plugins/'+n) for s,n in plugin)
items.append((ROOT/'release/DELIVERY_README.md','Carddesk示例库/开始使用.md'))
items.append((ROOT/'release/KNOWN_LIMITATIONS.md','Carddesk示例库/KNOWN_LIMITATIONS.md'))
pack(f'carddesk-example-vault-{VERSION}.zip',items)
shutil.copy2(ROOT/'release/DELIVERY_README.md',OUT/'INSTALL.md')
shutil.copy2(ROOT/'release/verify.py',OUT/'verify-release.py')
shutil.copy2(ROOT/'release/KNOWN_LIMITATIONS.md',OUT/'KNOWN_LIMITATIONS.md')
model={'id':'Qwen/Qwen3-Embedding-0.6B-GGUF','file':'Qwen3-Embedding-0.6B-Q8_0.gguf','bytes':639150592,'sha256':'06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439','officialUrl':'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf','weightsIncluded':False}
(OUT/'MODEL.json').write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n')
asset_names=[f'carddesk-plugin-{VERSION}.zip',f'carddesk-tools-{VERSION}.zip',f'carddesk-example-vault-{VERSION}.zip','INSTALL.md','verify-release.py','KNOWN_LIMITATIONS.md','MODEL.json']
try: source_commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True,stderr=subprocess.DEVNULL).strip()
except (OSError,subprocess.CalledProcessError): source_commit=None
if args.source_commit and (len(args.source_commit)!=40 or any(c not in '0123456789abcdef' for c in args.source_commit)):
 parser.error('--source-commit must be a full lowercase Git SHA')
manifest={'version':VERSION,'kind':'github-prerelease','sourceCommit':args.source_commit or source_commit,'packagingCommit':source_commit,'acceptanceStatus':'passed-scoped-local-test','scope':'P4 install/offline/fallback/workflow; quality/scale tasks deferred','files':{n:{'sha256':digest(OUT/n),'bytes':(OUT/n).stat().st_size} for n in asset_names}}
manifest['archiveContents']={}
for name in asset_names:
 if not name.endswith('.zip'):continue
 p=OUT/name
 with zipfile.ZipFile(p) as z:manifest['archiveContents'][p.name]={n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}
(OUT/'SHA256SUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(OUT)
