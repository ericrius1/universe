"""The microwave background: Planck's SMICA CMB temperature map, rendered to a plate carree in galactic coordinates.

  python -I pipeline/cmb.py     reads pipeline/raw/planck/, writes web/public/data/cmb/

Source: Planck 2015 (release 2) SMICA CMB map, COM_CMB_IQU-smica_1024_R2.02_full.fits from the IRSA Planck archive:
HEALPix Nside 1024, galactic coordinates, field 0 (I_STOKES), K_CMB, 5 arcmin resolution. SMICA is the component-
separation product that removes the Galaxy's own emission; along the galactic plane some residue is left (the map's own
TMASK marks it). The monopole (2.7255 K) and the dipole from our motion are already removed: what is left is the
+-few-hundred microkelvin anisotropy.

Rendered by bilinear interpolation on the sphere into 4096 x 2048, galactic longitude 0 at the centre and increasing to
the LEFT (as the sky is seen from inside, and as Planck's own pictures run), latitude +90 at the top.

Writes:
  smica_4k.webp   one channel (R = G = B), byte = round(127.5 + T / 500 uK * 127.5), clipped: -500 uK -> 0, +500 uK -> 255
  smica.json      the encoding, frame and credit
"""
import sys
import warnings
from pathlib import Path

import healpy as hp
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

OUT = WEB / 'cmb'
W, H = 4096, 2048
RANGE_UK = 500.0


def main():
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        m = hp.read_map(RAW / 'planck' / 'COM_CMB_IQU-smica_1024_R2.02_full.fits', field=0, dtype=np.float64)
    t_uk = m * 1e6
    print(f'map: Nside {hp.get_nside(m)}, std {t_uk.std():.1f} uK, 0.1/99.9% {np.percentile(t_uk, [0.1, 99.9])}')
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    lon = 180.0 - 360.0 * u            # +180 at the left edge, 0 at the centre, -180 at the right
    lat = 90.0 - 180.0 * v
    LON, LAT = np.meshgrid(lon, lat)
    img = hp.get_interp_val(t_uk, LON.ravel(), LAT.ravel(), lonlat=True).reshape(H, W)
    b = np.clip(np.round(127.5 + img / RANGE_UK * 127.5), 0, 255).astype(np.uint8)
    print(f'clipped: {(np.abs(img) > RANGE_UK).mean() * 100:.3f}% of pixels')
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'smica_4k.webp'
    Image.fromarray(b, 'L').save(path, 'WEBP', quality=82, method=6)
    print(f'{path.name}: {path.stat().st_size / 1e6:.2f} MB')
    write_json(OUT / 'smica.json', {
        'file': 'smica_4k.webp', 'size': [W, H],
        'frame': 'galactic coordinates, plate carree: u = (180 - l) / 360 (l = 0 at the centre, increasing to the left), '
                 'v = (90 - b) / 180',
        'encoding': {'channel': 'one (R = G = B)', 'temperature': 'T_uK = (byte - 127.5) / 127.5 * 500',
                     'rangeMicroK': [-RANGE_UK, RANGE_UK], 'stepMicroK': round(2 * RANGE_UK / 255, 2),
                     'clippedFraction': round(float((np.abs(img) > RANGE_UK).mean()), 5),
                     'note': 'WebP is lossy: about +-2 uK of coding noise, under the map\'s own noise'},
        'stdMicroK': round(float(t_uk.std()), 1),
        'source': 'Planck 2015 SMICA CMB map, COM_CMB_IQU-smica_1024_R2.02_full.fits, field I_STOKES (IRSA)',
        'credit': 'Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission with '
                  'instruments and contributions directly funded by ESA Member States, NASA, and Canada.',
        'caveat': 'Not inpainted: faint foreground residue remains along the galactic plane (|b| < ~5 deg).'})


if __name__ == '__main__':
    main()
