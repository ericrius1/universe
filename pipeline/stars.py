"""Real stars for the sky: every Hipparcos star to V 8, placed in space by its parallax, with the constellation figures
and the IAU's proper names.

  python -I pipeline/stars.py     reads pipeline/raw/{xhip,iau,d3-celestial}/, writes web/public/data/sky/

Source: XHIP, the Extended Hipparcos Compilation (Anderson & Francis 2012, VizieR V/137D), which joins the new
Hipparcos reduction's parallaxes (van Leeuwen 2007) with Johnson V and B-V for all 117,955 Hipparcos entries. Positions
are ICRS at the Hipparcos epoch J1991.25; we carry them to J2000 along their proper motions (8.75 years: at most 90" for
Barnard's star, a few arcseconds for most) so they line up with J2000 sky maps.

Distance: XHIP's Dist where it gives one (1000/Plx with a small bias correction, null when the parallax is worse than
20%); otherwise 1000/Plx when the parallax is at least twice its error; otherwise 1000/max(Plx, 2 e_Plx), a lower bound,
capped at 5 kpc, and flagged. Axes are equatorial J2000: +x toward RA 0h Dec 0, +y toward RA 6h Dec 0, +z the north
celestial pole. Parsecs.

Writes (records brightest first, little endian, 24 bytes each: f32 x, y, z (pc), f32 V, f32 B-V, u32 HIP | flags):
  stars6.bin   V <= 6.5
  stars8.bin   6.5 < V <= 8.0 (the next file on, not a superset)
  stars.json   their layout, counts and credit
  names.json   IAU proper names by Hipparcos number
  lines.json   constellation figures as pairs of Hipparcos numbers, with each constellation's name
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

OUT = WEB / 'sky'
FLAG_FALLBACK = 0x80000000  # the distance is a lower bound from a poor parallax
FLAG_NOCOLOR = 0x40000000   # B-V was missing and is estimated from V-I (or set to 0.65)
CREDIT = ('XHIP: Anderson & Francis 2012, Astronomy Letters 38, 331 (VizieR V/137D), from the Hipparcos new reduction '
          '(van Leeuwen 2007, ESA). VizieR catalogue service, CDS, Strasbourg.')


def fixed(lines, a, b, kind=float):
    """Columns a..b (1-based, inclusive, as in a VizieR ReadMe) as an array, NaN or -1 where blank."""
    out = []
    for ln in lines:
        s = ln[a - 1:b].strip()
        out.append(kind(s) if s else (np.nan if kind is float else -1))
    return np.array(out)


def read_xhip():
    main = gzip.open(RAW / 'xhip' / 'main.dat.gz', 'rt').read().splitlines()
    photo = gzip.open(RAW / 'xhip' / 'photo.dat.gz', 'rt').read().splitlines()
    t = {
        'hip': fixed(main, 1, 6, int), 'ra': fixed(main, 59, 70), 'de': fixed(main, 72, 83),
        'plx': fixed(main, 85, 90), 'pmra': fixed(main, 92, 99), 'pmde': fixed(main, 101, 108),
        'eplx': fixed(main, 124, 128), 'dist': fixed(main, 173, 179),
    }
    ph = {'hip': fixed(photo, 1, 6, int), 'v': fixed(photo, 60, 64), 'bv': fixed(photo, 140, 145),
          'vi': fixed(photo, 147, 151)}
    assert (t['hip'] == ph['hip']).all()
    t.update(v=ph['v'], bv=ph['bv'], vi=ph['vi'])
    return add_missing(t)


def add_missing(t):
    """The few Hipparcos stars to V 8 that XHIP leaves out (no astrometric solution: close binaries such as xi UMa),
    from the 1997 catalogue (VizieR I/239/hip_main), whose ground-based RA/Dec (J1991.25) they keep; no parallax."""
    have = set(t['hip'].tolist())
    add = {k: [] for k in t}
    for ln in (RAW / 'hip1997' / 'hip_main_V8.tsv').read_text().splitlines():
        f = ln.split('\t')
        if ln.startswith('#') or not f[0].strip().isdigit() or int(f[0]) in have:
            continue
        h, m, s = (float(x) for x in f[1].split())
        sg = -1.0 if f[2].strip().startswith('-') else 1.0
        dd, dm, ds = (abs(float(x)) for x in f[2].split())
        num = lambda x: float(x) if x.strip() else np.nan  # noqa: E731
        row = {'hip': int(f[0]), 'ra': 15.0 * (h + m / 60 + s / 3600), 'de': sg * (dd + dm / 60 + ds / 3600),
               'plx': np.nan, 'pmra': np.nan, 'pmde': np.nan, 'eplx': np.nan, 'dist': np.nan,
               'v': num(f[9]), 'bv': num(f[10]), 'vi': num(f[11])}
        for k in t:
            add[k].append(row[k])
    print(f'{len(add["hip"])} stars from Hipparcos 1997 that XHIP lacks: {add["hip"]}')
    return {k: np.concatenate([t[k], np.array(add[k], dtype=t[k].dtype)]) for k in t}


def to_j2000(t):
    """Carry RA/Dec from J1991.25 to J2000 along the proper motion (linear; fine over 8.75 years)."""
    dt = 2000.0 - 1991.25
    pmra = np.nan_to_num(t['pmra']) / 3.6e6  # deg/yr, along the great circle
    pmde = np.nan_to_num(t['pmde']) / 3.6e6
    de = t['de'] + pmde * dt
    ra = (t['ra'] + pmra * dt / np.cos(np.radians(t['de']))) % 360.0
    return ra, de


def distances(t):
    plx, eplx, dist = t['plx'], t['eplx'], t['dist']
    d = dist.copy()
    good = np.isnan(d) & (plx > 0) & (plx >= 2 * eplx)
    d[good] = 1000.0 / plx[good]
    poor = np.isnan(d)
    d[poor] = np.minimum(1000.0 / np.maximum(np.nan_to_num(plx[poor]), np.maximum(2 * np.nan_to_num(eplx[poor]), 0.2)),
                         5000.0)
    # No parallax at all: the median distance of well-measured stars within 0.25 mag of it (a placeholder, flagged).
    ok = ~poor
    for i in np.where(np.isnan(plx))[0]:
        near = ok & (np.abs(t['v'] - t['v'][i]) < 0.25)
        d[i] = np.median(d[near])
    return d, poor


def colours(t):
    bv = t['bv'].copy()
    miss = np.isnan(bv)
    # Johnson B-V from Cousins V-I for main-sequence-ish colours (a linear fit good to ~0.1 mag over 0 < V-I < 2).
    est = 0.85 * t['vi'] - 0.03
    bv[miss] = np.where(np.isnan(est[miss]), 0.65, est[miss])
    return bv, miss


def write_stars(t):
    ra, de = to_j2000(t)
    d, poor = distances(t)
    bv, nocol = colours(t)
    r, dd = np.radians(ra), np.radians(de)
    xyz = np.stack([d * np.cos(dd) * np.cos(r), d * np.cos(dd) * np.sin(r), d * np.sin(dd)], axis=1)
    v = t['v']
    keep = ~np.isnan(v)
    files = {}
    for name, lo, hi in (('stars6.bin', -2.0, 6.5), ('stars8.bin', 6.5, 8.0)):
        sel = np.where(keep & (v > lo) & (v <= hi))[0] if lo > -2 else np.where(keep & (v <= hi))[0]
        sel = sel[np.argsort(v[sel], kind='stable')]
        rec = np.zeros(len(sel), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('v', '<f4'), ('bv', '<f4'),
                                        ('hip', '<u4')])
        rec['x'], rec['y'], rec['z'] = xyz[sel].T
        rec['v'], rec['bv'] = v[sel], bv[sel]
        rec['hip'] = t['hip'][sel].astype(np.uint32) | np.where(poor[sel], FLAG_FALLBACK, 0).astype(np.uint32) \
            | np.where(nocol[sel], FLAG_NOCOLOR, 0).astype(np.uint32)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_bytes(rec.tobytes())
        files[name] = {'count': int(len(sel)), 'V': [float(v[sel].min()), float(v[sel].max())],
                       'fallbackDistances': int(poor[sel].sum()), 'estimatedColours': int(nocol[sel].sum())}
        print(f'{name}: {len(sel)} stars, {poor[sel].sum()} with fallback distances, {nocol[sel].sum()} estimated B-V')
    write_json(OUT / 'stars.json', {
        'files': files,
        'record': {'bytes': 24, 'littleEndian': True,
                   'fields': [['x', 'f32', 'pc'], ['y', 'f32', 'pc'], ['z', 'f32', 'pc'], ['V', 'f32', 'mag'],
                              ['BV', 'f32', 'mag'], ['hip', 'u32', 'Hipparcos number in the low 24 bits; flags above']],
                   'flags': {'0x80000000': 'distance is a lower bound from a poor parallax (capped at 5000 pc)',
                             '0x40000000': 'B-V missing in XHIP: estimated from V-I, or 0.65'}},
        'order': 'brightest (smallest V) first',
        'axes': 'equatorial J2000 (ICRS): +x to RA 0h Dec 0, +y to RA 6h Dec 0, +z to the north celestial pole; '
                'origin the Sun',
        'epoch': 'positions carried from J1991.25 to J2000 by proper motion',
        'distance': 'XHIP Dist, else 1000/Plx (Plx >= 2 e_Plx), else 1000/max(Plx, 2 e_Plx, 0.2 mas) capped 5000 pc; '
                    'the 19 stars with no Hipparcos parallax (added from I/239) get the median distance of '
                    'well-measured stars of their V, flagged',
        'credit': CREDIT, 'terms': 'VizieR/CDS: free to use with acknowledgement of the catalogue and of CDS',
    })
    return xyz, ra, de, v


def write_names(t):
    names = {}
    hips = set(t['hip'].tolist())
    lines = (RAW / 'iau' / 'IAU-CSN.txt').read_text(encoding='utf-8').splitlines()
    # Fixed-width columns, found from the header row: ASCII name, name with diacritics, designation, Bayer ID (ASCII,
    # then Greek), constellation, component, WDS, mag, band, HIP (right-aligned under its label), HD, ...
    h = next(ln for ln in lines if ln.startswith('#Name'))
    c_wds = h.index('WDS_J') + 11
    for ln in lines:
        if ln.startswith(('#', '$')) or not ln.strip():
            continue
        name = ln[0:18].strip()
        uname = ln[18:36].strip()
        desig = ln[36:49].strip()
        bayer = ln[55:61].strip()
        con = ln[61:65].strip()
        hip = ln[c_wds:].split()[2]  # after the WDS column: mag, band, HIP, HD, RA, Dec, date
        if not hip.isdigit():
            continue
        hip = int(hip)
        if hip not in hips:
            continue
        e = {'name': uname or name, 'designation': desig}
        if bayer and bayer != '_':
            e['bayer'] = f'{bayer} {con}'
        names.setdefault(str(hip), e)
    write_json(OUT / 'names.json', {
        'source': 'IAU Catalog of Star Names (IAU-CSN), IAU Division C Working Group on Star Names; '
                  'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt (last updated 2022-04-04)',
        'terms': 'IAU: CC BY 4.0 (credit the IAU WGSN)', 'byHip': names})
    print(f'names.json: {len(names)} named stars')
    return names


def write_lines(xyz, ra, de, v, hip):
    """Match each vertex of d3-celestial's figures to the brightest catalogue star within 0.25 deg of it."""
    feats = json.loads((RAW / 'd3-celestial' / 'constellations.lines.json').read_text())['features']
    meta = {f['id']: f['properties'] for f in
            json.loads((RAW / 'd3-celestial' / 'constellations.json').read_text())['features']}
    bright = np.where(v <= 7.0)[0]
    r, d = np.radians(ra[bright]), np.radians(de[bright])
    unit = np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)], axis=1)
    out, worst, misses = {}, 0.0, []

    def match(lon, lat):
        nonlocal worst
        a, b = np.radians(lon % 360.0), np.radians(lat)
        u = np.array([np.cos(b) * np.cos(a), np.cos(b) * np.sin(a), np.sin(b)])
        sep = np.degrees(np.arccos(np.clip(unit @ u, -1, 1)))
        near = np.where(sep < 0.25)[0]
        if len(near) == 0:
            misses.append((lon, lat, float(sep.min())))
            return None
        k = near[np.argmin(v[bright][near] + sep[near])]  # brightest wins; separation breaks near-ties
        worst = max(worst, float(sep[k]))
        return int(hip[bright][k])

    for f in feats:
        pairs = []
        for line in f['geometry']['coordinates']:
            ids = [match(lon, lat) for lon, lat in line]
            for a, b in zip(ids, ids[1:]):
                if a is not None and b is not None and a != b:
                    pairs.append([a, b])
        m = meta.get(f['id'], {})
        c = out.setdefault(f['id'], {'name': m.get('name', f['id']).replace(' Caput', '').replace(' Cauda', ''), 'genitive': m.get('gen'), 'lines': []})
        c['lines'] += pairs  # Serpens comes as two features (Caput and Cauda)
    write_json(OUT / 'lines.json', {
        'source': 'd3-celestial data/constellations.lines.json and constellations.json (Olaf Frohn, BSD-3-Clause), '
                  'each vertex matched to the brightest XHIP star within 0.25 deg',
        'credit': 'Constellation figures: d3-celestial, (c) 2015 Olaf Frohn, BSD 3-Clause License',
        'byConstellation': out}, compact=False)
    n = sum(len(c['lines']) for c in out.values())
    print(f'lines.json: {len(out)} constellations, {n} segments, worst match {worst * 60:.1f} arcmin, '
          f'{len(misses)} unmatched vertices {misses[:5]}')


def main():
    t = read_xhip()
    xyz, ra, de, v = write_stars(t)
    write_names(t)
    write_lines(xyz, ra, de, v, t['hip'])
    # Sense checks: Sirius (HIP 32349) at 2.64 pc, Vega (91262) 7.7 pc, Deneb (102098) ~430+ pc.
    for h, nm in ((32349, 'Sirius'), (91262, 'Vega'), (71683, 'alpha Cen A'), (102098, 'Deneb'), (24436, 'Rigel')):
        i = np.where(t['hip'] == h)[0][0]
        print(f'  {nm}: {np.linalg.norm(xyz[i]):.2f} pc, V {t["v"][i]:.2f}, B-V {t["bv"][i]:.2f}')


if __name__ == '__main__':
    main()
