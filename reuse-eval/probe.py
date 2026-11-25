#!/usr/bin/env python3
"""Small lexical feasibility probe, not a quality or scale benchmark."""
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'reuse-eval/results'
OUT.mkdir(exist_ok=True)


def qmd(*args):
    start = time.perf_counter()
    result = subprocess.run(['sh', str(ROOT / 'reuse-eval/qmd.sh'), *args],
                            text=True, capture_output=True, timeout=30, cwd=ROOT)
    return result, round((time.perf_counter() - start) * 1000)


cases = [('认知负担', 'cognitive-load.md'), ('关键词', 'retrieval.md'),
         ('原始资料', 'provenance.md'), ('更新旧卡', 'maintenance.md'),
         ('量子纠缠', None)]
records = []
for query, expected in cases:
    result, elapsed = qmd('search', query, '-c', 'jieye-reuse', '--json', '-n', '5')
    if result.returncode:
        raise RuntimeError(result.stderr)
    hits = json.loads(result.stdout) if result.stdout.strip().startswith('[') else []
    # This URI mapping is specific to the one isolated collection, not a global adapter.
    paths = []
    for hit in hits:
        uri = hit['file']
        prefix = 'qmd://jieye-reuse/'
        if not uri.startswith(prefix):
            raise ValueError('Unexpected collection: ' + uri)
        relative = Path(uri[len(prefix):])
        if relative.is_absolute() or '..' in relative.parts or relative.suffix != '.md':
            raise ValueError('Unexpected path: ' + uri)
        vault_relative = Path('ReuseWiki/wiki/reading') / relative
        target = ROOT / 'obsidian-plugin/test-vault' / vault_relative
        if not target.is_file():
            raise ValueError('Stale or missing candidate: ' + uri)
        paths.append(vault_relative.as_posix())
    records.append({'query': query, 'expected': expected, 'duration_ms': elapsed,
                    'paths': paths, 'hits': hits, 'stderr': result.stderr,
                    'expected_in_top5': any(Path(p).name == expected for p in paths)
                    if expected else not paths})

# Verify explicit update semantics with a disposable note outside the card package.
scratch = ROOT / 'obsidian-plugin/test-vault/ReuseWiki/wiki/reading/eval-update-probe.md'
if scratch.exists():
    raise RuntimeError('Refusing to overwrite existing probe')
updates = []
try:
    for text, query in [('# 临时索引探针\n\ncarddeskalphaprobe', 'carddeskalphaprobe'),
                        ('# 临时索引探针\n\ncarddeskbetaprobe', 'carddeskbetaprobe')]:
        scratch.write_text(text)
        update, _ = qmd('update')
        assert update.returncode == 0, update.stderr
        found, _ = qmd('search', query, '-c', 'jieye-reuse', '--json')
        assert found.returncode == 0 and 'eval-update-probe.md' in found.stdout
        updates.append({'operation': 'add' if len(updates) == 0 else 'modify',
                        'update': update.stdout, 'query': query, 'result': found.stdout})
finally:
    scratch.unlink(missing_ok=True)
    update, _ = qmd('update')
    if update.returncode:
        raise RuntimeError(update.stderr)
removed, _ = qmd('search', 'carddeskbetaprobe', '-c', 'jieye-reuse', '--json')
assert removed.returncode == 0 and 'eval-update-probe.md' not in removed.stdout
updates.append({'operation': 'delete', 'update': update.stdout, 'result': removed.stdout})
(OUT / 'lexical-probe.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
(OUT / 'update-probe.json').write_text(json.dumps(updates, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'cases': len(records), 'expected_in_top5': sum(r['expected_in_top5'] for r in records),
                  'update_checks': len(updates), 'vector_tested': False}, ensure_ascii=False))
