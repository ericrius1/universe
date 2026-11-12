"""The Moon: colour and height from NASA's CGI Moon Kit (SVS 4720, Ernie Wright, NASA Goddard Scientific Visualization
Studio), which is built from the Lunar Reconnaissance Orbiter's LROC WAC colour mosaic and LOLA's elevation model.

  python -I pipeline/moon.py     reads pipeline/raw/moon/, writes web/public/data/moon/

Both maps are plate carree, longitude -180 at the left edge to +180 at the right (the near side, longitude 0, in the
middle), latitude +90 at the top.

Writes:
  color_4k.webp    4096 x 2048 RGB, from lroc_color_poles_4k.tif (the version with the polar gaps filled)
  height_1440.png  1440 x 720, 16-bit greyscale: height above the 1737.4 km reference sphere in 10 m steps,
                   km = value * 0.01 - 10 (from ldem_4.tif, float km, 4 pixels a degree)
  moon.json        the layout and credit
"""
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

OUT = WEB / 'moon'
LO, STEP = -10.0, 0.01  # 10 m steps


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    c = tifffile.imread(RAW / 'moon' / 'lroc_color_poles_4k.tif')
    Image.fromarray(c).save(OUT / 'color_4k.webp', 'WEBP', quality=86, method=6)
    h = tifffile.imread(RAW / 'moon' / 'ldem_4.tif').astype(np.float64)
    assert LO < h.min()
    q = np.round((h - LO) / STEP).astype(np.uint16)
    Image.fromarray(q).save(OUT / 'height_1440.png', optimize=True)
    for f in ('color_4k.webp', 'height_1440.png'):
        print(f'{f}: {(OUT / f).stat().st_size / 1e6:.2f} MB')
    print(f'height range {h.min():.2f} .. {h.max():.2f} km')
    write_json(OUT / 'moon.json', {
        'projection': 'plate carree: u = (lon + 180) / 360, v = (90 - lat) / 180; the near side (lon 0) at u = 0.5',
        'files': {'color_4k.webp': {'size': [4096, 2048], 'channels': 'RGB, sRGB',
                                    'source': 'LROC WAC colour (lroc_color_poles_4k.tif)'},
                  'height_1440.png': {'size': [1440, 720], 'channels': '16-bit greyscale',
                                      'decode': f'km = value * {STEP} + ({LO})',
                                      'reference': 'height above a sphere of radius 1737.4 km',
                                      'rangeKm': [round(float(h.min()), 3), round(float(h.max()), 3)],
                                      'source': 'LOLA elevation (ldem_4.tif)'}},
        'source': 'https://svs.gsfc.nasa.gov/4720',
        'credit': 'NASA\'s Scientific Visualization Studio (Ernie Wright), CGI Moon Kit; LRO LROC and LOLA teams',
        'terms': 'NASA SVS: public domain, credit NASA SVS'})


if __name__ == '__main__':
    main()
