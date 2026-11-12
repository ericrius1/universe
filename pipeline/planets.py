"""Planet maps that are honestly public: Mercury, Mars, Jupiter and Saturn, and the opacity of Saturn's rings.

  python -I pipeline/planets.py     reads pipeline/raw/{planets,rings}/, writes web/public/data/planets/

All maps are simple cylindrical, latitude +90 at the top. Longitude conventions differ by source and are given in
planets.json (the rocky planets centre on longitude 0, east to the right; the giants run System III west longitude
from 360 at the left edge down to 0 at the right).

  mercury_2k.webp  MESSENGER MDIS 3-colour global mosaic, 665 m, v3 (USGS Astrogeology / ASU / MESSENGER team):
                   colour from three WAC filters (its label doesn't name them), stronger than the eye would see
  mars_2k.webp     Viking MDIM 2.1 colourised global mosaic, 925 m (USGS Astrogeology)
  jupiter_2k.webp  Cassini ISS, December 2000, PIA07782 (NASA/JPL/Space Science Institute), near true colour
  saturn_2k.webp   Hubble OPAL 2025a, F631N/F502N/F395N as R/G/B (NASA/ESA, A. Simon, OPAL), the rings' band and the
                   unobserved polar caps filled from the nearest observed latitude (listed in planets.json)
  saturn_rings_tau.bin  Saturn's rings' normal optical depth, 72,000-142,500 km every 10 km, f32, from Voyager 2's
                   PPS stellar occultation of delta Scorpii (PDS Ring-Moon Systems Node, VG_2801)

The two USGS mosaics were read at 2048 x 1024 from the ~800 MB originals by fetch_usgs.py.
"""
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

SRC = RAW / 'planets'
OUT = WEB / 'planets'
W, H = 2048, 1024


def save(a, name, q=86):
    im = Image.fromarray(a) if isinstance(a, np.ndarray) else a
    im.save(OUT / name, 'WEBP', quality=q, method=6)
    print(f'{name}: {im.size}, {(OUT / name).stat().st_size / 1e6:.2f} MB')


def fill_saturn(a):
    """Fill what OPAL couldn't see (the ring band near the equator and the polar caps, black in its map). Holes are
    widened by 8 px to drop their colour-fringed edges; latitudes mostly unseen take the zonal mean of the nearest seen
    latitudes (Saturn's bands are zonal), and stray holes elsewhere are interpolated along their column."""
    bad = a.max(2) < 12
    for _ in range(8):
        bad = bad | np.roll(bad, 1, 0) | np.roll(bad, -1, 0)
    bad[0], bad[-1] = True, True
    out = a.astype(np.float32).copy()
    rows = np.arange(a.shape[0])
    filled = bad.mean(1) > 0.3
    means = np.array([out[i][~bad[i]].mean(0) if (~bad[i]).any() else np.zeros(3) for i in rows])
    good_rows = ~filled
    for c in range(3):
        zonal = np.interp(rows, rows[good_rows], means[good_rows, c])
        out[filled, :, c] = zonal[filled, None]
    bad[filled] = False
    for x in np.where(bad.any(0))[0]:
        good = ~bad[:, x]
        for c in range(3):
            out[:, x, c] = np.interp(rows, rows[good], out[good, x, c])
    lat = 90 - (rows + 0.5) * 180 / a.shape[0]
    spans, start = [], None
    for i, f in enumerate(filled):
        if f and start is None:
            start = i
        if not f and start is not None:
            spans.append([round(float(lat[start]), 1), round(float(lat[i - 1]), 1)])
            start = None
    if start is not None:
        spans.append([round(float(lat[start]), 1), round(float(lat[-1]), 1)])
    return np.clip(np.round(out), 0, 255).astype(np.uint8), spans


def fill_holes(a, dark=6):
    """Fill the mosaic's no-data pixels (pure black) by normalised convolution: a widening blur of the good pixels,
    divided by the blur of the good mask, until every hole has a value. Returns the image and the filled fraction."""
    from scipy.ndimage import gaussian_filter
    from scipy.ndimage import binary_dilation
    good = (~binary_dilation(a.max(2) <= dark, iterations=6)).astype(np.float32)  # drop the holes' fringed rims
    out = a.astype(np.float32)
    hole = good < 0.5
    sigma = 2.0
    while hole.any():
        w = gaussian_filter(good, sigma, mode='wrap')
        for c in range(3):
            v = gaussian_filter(out[..., c] * good, sigma, mode='wrap') / np.maximum(w, 1e-6)
            out[..., c] = np.where(hole & (w > 1e-3), v, out[..., c])
        newly = hole & (w > 1e-3)
        good = np.maximum(good, newly.astype(np.float32))
        hole = good < 0.5
        sigma *= 2
    return np.clip(np.round(out), 0, 255).astype(np.uint8), float((a.max(2) <= dark).mean())


def rings():
    r, tau, lo = [], [], []
    for ln in (RAW / 'rings' / 'PS1P01_10km.TAB').read_text().splitlines():
        f = [float(x) for x in ln.split(',')]
        r.append(f[0])
        tau.append(f[3])
        lo.append(f[4])
    r, tau, lo = np.array(r), np.array(tau), np.array(lo)
    sat = tau >= 98
    tau = np.where(sat, np.clip(np.where(lo >= 98, 5.0, lo), 2.5, 5.0), np.maximum(tau, 0.0)).astype('<f4')
    (OUT / 'saturn_rings_tau.bin').write_bytes(tau.tobytes())
    print(f'saturn_rings_tau.bin: {len(tau)} samples, {sat.sum()} opaque, max tau {tau.max():.2f}')
    return {'file': 'saturn_rings_tau.bin', 'count': int(len(tau)), 'radiusKm': [float(r[0]), float(r[-1])],
            'stepKm': 10.0, 'type': 'f32 little endian, normal optical depth tau (>= 0)',
            'saturated': f'{int(sat.sum())} samples where the star vanished (dense B ring) carry their lower limit, '
                         'at least 2.5 (5 where even that is unknown)',
            'use': 'transmission along a ray = exp(-tau / |cos(incidence)|); opacity seen face on = 1 - exp(-tau)',
            'colour': 'none: no public-domain radial colour profile was assembled (see SOURCES.md)',
            'source': 'Voyager 2 PPS delta Sco occultation, 1981-08-26, PDS VG_2801 EASYDATA/KM010/PS1P01.TAB',
            'credit': 'NASA/JPL Voyager PPS team (Esposito, Lane et al.); PDS Ring-Moon Systems Node'}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    if (SRC / 'mercury_messenger_clr_665m_v3_2048.png').exists():
        m, frac = fill_holes(np.asarray(Image.open(SRC / 'mercury_messenger_clr_665m_v3_2048.png').convert('RGB')))
        # Beyond 75 deg the colour mosaic is mostly noise between the filters: fade it to its own luminance by 85 deg.
        lat = 90 - (np.arange(H) + 0.5) * 180 / H
        k = np.clip((np.abs(lat) - 75) / 10, 0, 1)[:, None, None]
        lum = (m.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        m = np.clip(np.round(m * (1 - k) + lum * k), 0, 255).astype(np.float32)
        # Above 82 deg N the mosaic holds blocks of fill rather than ground: the zonal mean of 82 deg goes on to the pole.
        cap = lat > 82
        m[cap] = m[np.argmin(np.abs(lat - 82))].mean(0)
        m = np.round(m).astype(np.uint8)
        save(m, 'mercury_2k.webp')
        meta['mercury_2k.webp'] = {
            'size': [W, H], 'longitude': 'centre 0, east positive, -180 at the left edge',
            'source': 'USGS Astrogeology, Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif (MDIS WAC 3-colour)',
            'colour': 'three MDIS WAC filters as R, G, B (not named in the product label): enhanced, not natural; '
                      'Mercury is a nearly neutral grey to the eye',
            'filled': f'{frac * 100:.1f}% of pixels had no data (gaps, the north polar cap) and were filled by a '
                      'widening blur of their neighbours; colour fades to grey from 75 to 85 deg latitude (polar filter noise); north of 82 deg N is a flat zonal fill',
            'credit': 'NASA/Johns Hopkins University Applied Physics Laboratory/Carnegie Institution of Washington; '
                      'USGS Astrogeology'}
    save(Image.open(SRC / 'mars_viking_clr_925m_2048.png').convert('RGB'), 'mars_2k.webp')
    meta['mars_2k.webp'] = {
        'size': [W, H], 'longitude': 'centre 0, east positive, -180 at the left edge',
        'source': 'USGS Astrogeology, Mars_Viking_ClrMosaic_global_925m.tif (MDIM 2.1, colourised)',
        'credit': 'NASA/JPL/USGS (Viking Orbiter; USGS Astrogeology)'}
    j = tifffile.imread(SRC / 'PIA07782.tif')
    save(Image.fromarray(j).resize((W, H), Image.LANCZOS), 'jupiter_2k.webp')
    meta['jupiter_2k.webp'] = {
        'size': [W, H], 'longitude': 'full 360 deg, planetocentric latitude; orientation not stated in the caption',
        'source': 'PIA07782, Cassini\'s Best Maps of Jupiter (cylindrical), 3601 x 1801, December 2000',
        'note': 'the polar regions beyond ~60 deg were not imaged and are a flat fill in the original',
        'credit': 'NASA/JPL/Space Science Institute'}
    s = tifffile.imread(SRC / 'opal_saturn-2025a_rgb.tif').transpose(1, 2, 0)
    s, spans = fill_saturn(s)
    save(s, 'saturn_2k.webp')  # kept at its native 1800 x 900 (5 px a degree); not enlarged
    meta['saturn_2k.webp'] = {
        'size': [s.shape[1], s.shape[0]],
        'longitude': 'System III west longitude, 360 at the left edge decreasing to 0 at the right',
        'latitude': 'planetographic, -90..90 at 5 px a degree (native size, not enlarged to 2048)',
        'filledLatitudes': spans, 'filled': 'rows OPAL did not see (ring band, polar caps) interpolated per column',
        'colour': 'F631N, F502N, F395N as R, G, B with OPAL\'s slight contrast enhancement',
        'source': 'MAST HLSP OPAL, hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif',
        'credit': 'NASA, ESA, A. Simon (GSFC) and the OPAL team. This work used data acquired from the NASA/ESA HST '
                  'Space Telescope, associated with OPAL program (PI: Simon, GO13937), and archived by the Space '
                  'Telescope Science Institute (doi:10.17909/T9G593).'}
    meta['saturn_rings_tau.bin'] = rings()
    write_json(OUT / 'planets.json', {
        'projection': 'simple cylindrical (plate carree), latitude +90 at the top', 'maps': meta,
        'missing': {'venus': 'no free, honest global colour map of its clouds', 'uranus': 'none made',
                    'neptune': 'none made'},
        'terms': 'USGS, NASA/JPL and PDS products are public domain; OPAL HLSP is free to use with the acknowledgement '
                 'above'})


if __name__ == '__main__':
    main()
