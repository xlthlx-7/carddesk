"""Verify local artifacts and their ZIP members using Python's standard library."""
from pathlib import Path,PurePosixPath
import json,hashlib,sys,zipfile
folder=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
m=json.loads((folder/'SHA256SUMS.json').read_text())
for name,info in m['files'].items():
 p=folder/name
 assert p.stat().st_size==info['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==info['sha256'],name
for name,entries in m['archiveContents'].items():
 with zipfile.ZipFile(folder/name) as z:
  assert set(z.namelist())==set(entries),name
  for member,sha in entries.items():
   path=PurePosixPath(member);assert not path.is_absolute() and '..' not in path.parts,member
   assert hashlib.sha256(z.read(member)).hexdigest()==sha,member
print('Verified',len(m['files']),'files and',sum(map(len,m['archiveContents'].values())),'archive members; version',m['version'])
