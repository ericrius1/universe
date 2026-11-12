"""Downloads for the data pipeline, kept in one place so every file's origin is on record.

  get(url, 'xhip/main.dat.gz')    fetch url into pipeline/raw/xhip/main.dat.gz unless it is already there

Each download is logged in pipeline/raw/manifest.json (url, local path, the date fetched, its size in bytes), which is
what pipeline/SOURCES.md is written from. Raw files are data: they are read, never run. pipeline/raw/ is not in git.

  python -I pipeline/fetch.py     print the manifest as a Markdown table
"""
import datetime
import json
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'raw'
WEB = ROOT.parent / 'web' / 'public' / 'data'
MANIFEST = RAW / 'manifest.json'
UA = 'universe-data-pipeline/1.0 (python urllib)'
MAX_BYTES = 450_000_000


def manifest():
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def get(url, rel, data=None, timeout=600):
    """Fetch url (POST data if given) to RAW/rel once; return the local Path."""
    dest = RAW / rel
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    tmp = dest.with_name(dest.name + '.part')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        size = r.headers.get('Content-Length')
        if size and int(size) > MAX_BYTES:
            raise RuntimeError(f'{url} is {int(size) / 1e6:.0f} MB, over the {MAX_BYTES / 1e6:.0f} MB cap')
        with open(tmp, 'wb') as f:
            shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(dest)
    m = manifest()
    m[rel] = {'url': url, 'fetched': datetime.date.today().isoformat(), 'bytes': dest.stat().st_size}
    MANIFEST.write_text(json.dumps(m, indent=1, sort_keys=True))
    print(f'fetched {rel}: {dest.stat().st_size / 1e6:.2f} MB', file=sys.stderr)
    return dest


def write_json(path, obj, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        path.write_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False))
    else:
        path.write_text(json.dumps(obj, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    print('| local file | url | fetched | bytes |\n|---|---|---|---|')
    for rel, e in sorted(manifest().items()):
        print(f"| {rel} | {e['url']} | {e['fetched']} | {e['bytes']:,} |")
