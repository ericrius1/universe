"""Fetch a 2048 x 1024 reduction of a USGS Astrogeology global mosaic without downloading all of it.

  python -I pipeline/fetch_usgs.py

The Mars Viking and Mercury MESSENGER colour mosaics are ~800 MB each, over the pipeline's 450 MB cap for one file. They
are uncompressed, band-sequential GeoTIFFs, so any row can be read with an HTTP range request. For each output row we read
4 neighbouring source rows near its centre (of the ~11 it covers) in each band and average them, and average across
columns in boxes of the source-to-output ratio: about a third of each file crosses the network, and only the reduction
is kept, as a lossless PNG in pipeline/raw/planets/ (logged in the manifest with the source URL).
"""
import datetime
import io
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import MANIFEST, RAW, UA, manifest  # noqa: E402

S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/'
MOSAICS = {
    'planets/mars_viking_clr_925m_2048.png': S3 + 'Mars_Viking_ClrMosaic_global_925m.tif',
    'planets/mercury_messenger_clr_665m_v3_2048.png': S3 + 'Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif',
}
W, H, TAPS = 2048, 1024, 4


def ranged(url, start, length):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Range': f'bytes={start}-{start + length - 1}'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = r.read()
            assert len(d) == length
            return d
        except Exception:  # noqa: BLE001 (retry a dropped connection)
            if attempt == 4:
                raise


class HTTPFile(io.RawIOBase):
    """Just enough of a seekable file for tifffile to read the TIFF's tags over HTTP."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})) as r:
            self.size = int(r.headers['Content-Length'])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, o, w=0):
        self.pos = o if w == 0 else self.pos + o if w == 1 else self.size + o
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        d = ranged(self.url, self.pos, n)
        b[:n] = d
        self.pos += n
        return n


def reduce(url):
    with tifffile.TiffFile(io.BufferedReader(HTTPFile(url), 1 << 16)) as t:
        p = t.pages[0]
        bands, rows, cols = p.shape
        assert p.compression == 1 and p.planarconfig == 2 and p.dtype == np.uint8
        offs, counts, rps = np.array(p.dataoffsets), np.array(p.databytecounts), p.rowsperstrip
    per_band = len(offs) // bands

    def row_offset(band, r):
        s = band * per_band + r // rps
        return int(offs[s]) + (r % rps) * cols

    def out_row(job):
        band, j = job
        r0 = int((j + 0.5) * rows / H) - TAPS // 2
        r0 = min(max(r0, 0), rows - TAPS)
        if r0 // rps == (r0 + TAPS - 1) // rps:
            buf = np.frombuffer(ranged(url, row_offset(band, r0), TAPS * cols), np.uint8).reshape(TAPS, cols)
        else:
            buf = np.stack([np.frombuffer(ranged(url, row_offset(band, r0 + k), cols), np.uint8) for k in range(TAPS)])
        line = buf.astype(np.float32).mean(0)
        edges = np.round(np.linspace(0, cols, W + 1)).astype(int)
        return band, j, np.add.reduceat(line, edges[:-1]) / np.diff(edges)

    img = np.zeros((H, W, bands), np.float32)
    with ThreadPoolExecutor(16) as ex:
        for band, j, line in ex.map(out_row, [(b, j) for b in range(bands) for j in range(H)]):
            img[j, :, band] = line
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def main():
    for rel, url in MOSAICS.items():
        dest = RAW / rel
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(reduce(url)).save(dest)
        m = manifest()
        m[rel] = {'url': url, 'fetched': datetime.date.today().isoformat(), 'bytes': dest.stat().st_size,
                  'note': f'reduced to {W}x{H} by ranged reads ({TAPS} rows per output row); the full file was not kept'}
        MANIFEST.write_text(json.dumps(m, indent=1, sort_keys=True))
        print(f'{rel}: {dest.stat().st_size / 1e6:.1f} MB', file=sys.stderr)


if __name__ == '__main__':
    main()
