"""One picture of everything the pipeline ships, and a table of every shipped file, for looking at by eye.

  python -I pipeline/contact_sheet.py <out dir>     writes <out dir>/contact_sheet.jpg and <out dir>/files.md

Each map is shown whole with its name, pixel size and file size; the binary data are drawn too: the stars on the sky
(plate carree, RA 0 at the centre), the 2MRS galaxies and the density volume in a 40 Mpc slab through the Sun, and the
rings' opacity against radius.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import WEB  # noqa: E402

TILE_W, TILE_H, PAD, LABEL = 600, 300, 10, 34
DIRS = ['sky', 'galaxies', 'cmb', 'globe', 'moon', 'planets', 'orbits']


def font(n):
    for f in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(f, n)
        except OSError:
            pass
    return ImageFont.load_default()


def kb(p):
    return f'{p.stat().st_size / 1e6:.2f} MB' if p.stat().st_size > 1e5 else f'{p.stat().st_size / 1e3:.1f} kB'


def fit(im, w=TILE_W, h=TILE_H):
    im = im.convert('RGB')
    s = min(w / im.width, h / im.height)
    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    out = Image.new('RGB', (w, h), (24, 24, 28))
    out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out


def stars_plot():
    img = np.zeros((TILE_H, TILE_W, 3), np.float32)
    for name, gain in (('stars8.bin', 0.5), ('stars6.bin', 1.0)):
        rec = np.frombuffer((WEB / 'sky' / name).read_bytes(), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
                                                                      ('v', '<f4'), ('bv', '<f4'), ('hip', '<u4')])
        p = np.stack([rec['x'], rec['y'], rec['z']], 1)
        r = np.linalg.norm(p, axis=1)
        ra = np.degrees(np.arctan2(p[:, 1], p[:, 0]))
        de = np.degrees(np.arcsin(p[:, 2] / r))
        u = ((180 - ra) % 360 / 360 * TILE_W).astype(int) % TILE_W  # RA increasing to the left, 180 at the centre
        v = ((90 - de) / 180 * TILE_H).astype(int).clip(0, TILE_H - 1)
        flux = gain * 10 ** (-0.4 * (rec['v'] - 4.5))
        t = np.clip(rec['bv'], -0.3, 2.0)
        col = np.stack([0.8 + 0.2 * t, 0.85 + 0.0 * t, 1.1 - 0.4 * t], 1)
        np.add.at(img, (v, u), col * flux[:, None])
    return Image.fromarray((np.clip(img, 0, 1) ** 0.45 * 255).astype(np.uint8))


def galaxy_plot():
    rec = np.frombuffer((WEB / 'galaxies' / '2mrs.bin').read_bytes(), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
                                                                            ('l', '<f4'), ('t', '<u4')])
    slab = np.abs(rec['z']) < 20
    img = np.zeros((TILE_H, TILE_H, 3), np.float32)
    half = 200
    u = ((rec['x'][slab] + half) / (2 * half) * TILE_H).astype(int)
    v = ((half - rec['y'][slab]) / (2 * half) * TILE_H).astype(int)
    ok = (u >= 0) & (u < TILE_H) & (v >= 0) & (v < TILE_H)
    typ = rec['t'][slab][ok] & 0xFF
    col = np.array([[0.6, 0.6, 0.6], [0.5, 0.7, 1.0], [1.0, 0.7, 0.4], [0.6, 1.0, 0.6]], np.float32)[typ]
    np.add.at(img, (v[ok], u[ok]), col * 0.6)
    dens = np.frombuffer((WEB / 'galaxies' / 'density.bin').read_bytes(), np.uint8).reshape(128, 128, 128)
    sl = dens[64].astype(np.float32)  # z = 0 slice, [y][x]
    d = np.asarray(Image.fromarray(sl[::-1].astype(np.uint8)).resize((TILE_H, TILE_H), Image.BILINEAR)) / 255.0
    left = Image.fromarray((np.clip(img, 0, 1) ** 0.6 * 255).astype(np.uint8))
    right = Image.fromarray((np.stack([d ** 1.5, d ** 1.2 * 0.8, d], 2) * 255).astype(np.uint8))
    out = Image.new('RGB', (TILE_W, TILE_H))
    out.paste(left, (0, 0))
    out.paste(right, (TILE_H, 0))
    return out


def rings_plot():
    tau = np.frombuffer((WEB / 'planets' / 'saturn_rings_tau.bin').read_bytes(), '<f4')
    im = Image.new('RGB', (TILE_W, TILE_H), (24, 24, 28))
    d = ImageDraw.Draw(im)
    op = 1 - np.exp(-tau)
    xs = np.linspace(0, len(tau) - 1, TILE_W).astype(int)
    for x, i in enumerate(xs):
        y = int((1 - op[i]) * (TILE_H - 40)) + 20
        d.line([(x, TILE_H - 20), (x, y)], fill=(200, 190, 160))
    d.text((6, 4), 'opacity 1-exp(-tau), 72,000 to 142,500 km', fill=(255, 255, 255), font=font(14))
    return im


def tiles():
    out = []
    for d in DIRS:
        for p in sorted((WEB / d).glob('*')):
            if p.suffix in ('.webp', '.png'):
                im = Image.open(p)
                if im.mode.startswith('I'):  # 16-bit: stretch to 8 bits to look at
                    a = np.asarray(im).astype(np.float32)
                    im = Image.fromarray(((a - a.min()) / (a.max() - a.min()) * 255).astype(np.uint8))
                out.append((f'{d}/{p.name}  {im.width}x{im.height}  {kb(p)}', fit(im)))
    out.append((f'sky/stars6.bin + stars8.bin  {kb(WEB / "sky/stars6.bin")} + {kb(WEB / "sky/stars8.bin")}  (sky plot)',
                stars_plot()))
    out.append((f'galaxies/2mrs.bin {kb(WEB / "galaxies/2mrs.bin")} | density.bin {kb(WEB / "galaxies/density.bin")}'
                f'  (|z|<20 Mpc)', galaxy_plot()))
    out.append((f'planets/saturn_rings_tau.bin  {kb(WEB / "planets/saturn_rings_tau.bin")}', rings_plot()))
    return out


def main():
    dest = Path(sys.argv[1])
    dest.mkdir(parents=True, exist_ok=True)
    ts = tiles()
    cols = 4
    rows = (len(ts) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (TILE_W + PAD) + PAD, rows * (TILE_H + LABEL + PAD) + PAD), (8, 8, 10))
    d = ImageDraw.Draw(sheet)
    f = font(16)
    for i, (label, im) in enumerate(ts):
        x = PAD + (i % cols) * (TILE_W + PAD)
        y = PAD + (i // cols) * (TILE_H + LABEL + PAD)
        sheet.paste(im, (x, y + LABEL))
        d.text((x + 2, y + 8), label, fill=(235, 235, 235), font=f)
    sheet.save(dest / 'contact_sheet.jpg', quality=88)
    rows_md = ['| file | bytes | what | source | terms |', '|---|---:|---|---|---|']
    info = json.loads((Path(__file__).resolve().parent / 'shipped.json').read_text())
    total = 0
    for dname in DIRS:
        for p in sorted((WEB / dname).glob('*')):
            rel = f'{dname}/{p.name}'
            total += p.stat().st_size
            what, src, terms = info.get(rel, ['', '', ''])
            rows_md.append(f'| {rel} | {p.stat().st_size:,} | {what} | {src} | {terms} |')
    rows_md.append(f'| **total** | {total:,} | | | |')
    (dest / 'files.md').write_text('\n'.join(rows_md) + '\n')
    print(f'{dest / "contact_sheet.jpg"}: {len(ts)} tiles; {dest / "files.md"}: total {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
