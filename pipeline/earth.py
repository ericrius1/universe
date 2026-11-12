"""The Earth's maps: day colour, night lights, clouds, relief and a land/water mask, all plate carree on one grid.

  python -I pipeline/earth.py     reads pipeline/raw/earth/, writes web/public/data/globe/

Every map is equirectangular, longitude -180 at the left edge to +180 at the right (Greenwich in the middle column),
latitude +90 at the top. Sources (NASA Earth Observatory, public domain):
  Blue Marble Next Generation, December 2004, with topography and bathymetry (Reto Stockli, NASA Earth Observatory),
    21600 x 10800 JPEG
  Black Marble 2016 night lights, greyscale, 3 km (13500 x 6750)  (NASA Earth Observatory / Joshua Stevens, Suomi NPP VIIRS)
  The original Blue Marble's combined cloud map (2002), 2048 x 1024: the only size NASA still serves
  GEBCO_08 topography and bathymetry greyscales as served with Blue Marble Next Generation (21600 x 10800)

Writes WebP:
  day_8k.webp, day_4k.webp    colour, 8192 x 4096 and 4096 x 2048
  night_4k.webp               night lights, one channel, 4096 x 2048
  clouds_2k.webp              cloud cover, one channel (stored as greyscale), 2048 x 1024
  relief_4k.webp              one channel: 0..127 ocean (darker deeper), 128..255 land (brighter higher)
  mask_4k.webp                one channel: 255 land, 0 water (lossless)
  globe.json                  the layout, the encodings and the credits
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
SRC = RAW / 'earth'
OUT = WEB / 'globe'


def shrink(im, size):
    """Box-reduce by an integer factor close to the target, then Lanczos to the exact size."""
    f = max(1, int(im.width // size[0]))
    if f > 1:
        im = im.reduce(f)
    return im.resize(size, Image.LANCZOS) if im.size != size else im


def save(im, name, **kw):
    path = OUT / name
    im.save(path, 'WEBP', method=6, **kw)
    print(f'{name}: {im.size[0]}x{im.size[1]} {im.mode}, {path.stat().st_size / 1e6:.2f} MB')
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    day = Image.open(SRC / 'world.topo.bathy.200412.3x21600x10800.jpg').convert('RGB')
    save(shrink(day, (8192, 4096)), 'day_8k.webp', quality=80)
    save(shrink(day, (4096, 2048)), 'day_4k.webp', quality=86)
    del day

    # The greyscale Black Marble: city light alone on black (the colour one tints all land blue, which a renderer
    # would have to undo).
    night = Image.open(SRC / 'BlackMarble_2016_3km_gray.jpg').convert('L')
    save(night.resize((4096, 2048), Image.LANCZOS), 'night_4k.webp', quality=85)

    clouds = Image.open(SRC / 'cloud_combined_2048.jpg').convert('L')
    save(clouds, 'clouds_2k.webp', quality=88)

    elev_full = Image.open(SRC / 'gebco_08_rev_elev_21600x10800.jpg').convert('L')
    bath_full = Image.open(SRC / 'gebco_08_rev_bath_21600x10800.jpg').convert('L')
    elev = np.asarray(shrink(elev_full, (4096, 2048)), np.float32)
    bath = np.asarray(shrink(bath_full, (4096, 2048)), np.float32)
    # The bathymetry greyscale is exactly white (255) on land and darker with depth, though continental shelves are
    # only a step or two below white (253-254); the elevation greyscale is black (0) at sea level and brighter with
    # height. Land: most of a cell's source pixels pure white in the bathymetry, or above sea level in the elevation.
    white = Image.fromarray(((np.asarray(bath_full) >= 255) * 255).astype(np.uint8), 'L')
    frac = np.asarray(shrink(white, (4096, 2048)), np.float32) / 255
    land = (frac > 0.5) | (elev > 2)
    del elev_full, bath_full, white
    relief = np.where(land, 128 + elev * 127 / 255, bath * 127 / 255)
    save(Image.fromarray(np.clip(np.round(relief), 0, 255).astype(np.uint8), 'L'), 'relief_4k.webp', quality=90)
    save(Image.fromarray((land * 255).astype(np.uint8), 'L'), 'mask_4k.webp', lossless=True)
    print(f'land fraction (area-weighted): {np.average(land, weights=np.cos(np.radians(90 - (np.arange(2048)[:, None] + 0.5) * 180 / 2048)) * np.ones((1, 4096))):.3f}')

    write_json(OUT / 'globe.json', {
        'oneChannel': 'WebP has no greyscale mode: the one-channel maps decode as RGB with R = G = B; read R',
        'projection': 'equirectangular (plate carree): u = (lon + 180) / 360, v = (90 - lat) / 180; Greenwich at u = 0.5',
        'maps': {
            'day_8k.webp': {'size': [8192, 4096], 'channels': 'RGB, sRGB',
                            'source': 'Blue Marble Next Generation, December 2004, with topography and bathymetry'},
            'day_4k.webp': {'size': [4096, 2048], 'channels': 'RGB, sRGB', 'source': 'as day_8k'},
            'night_4k.webp': {'size': [4096, 2048], 'channels': 'one (greyscale): night light, sRGB-encoded',
                              'source': 'Black Marble 2016 (greyscale), Suomi NPP VIIRS day/night band composite'},
            'clouds_2k.webp': {'size': [2048, 1024], 'channels': 'one (greyscale): cloud brightness, 0 clear',
                               'source': 'Blue Marble (2002) combined cloud map; NASA serves only 2048 x 1024 now'},
            'relief_4k.webp': {'size': [4096, 2048], 'channels': 'one: 0..127 ocean (127 shoreline, darker deeper), '
                               '128..255 land (128 sea level, brighter higher); NASA\'s greyscales, not metres',
                               'source': 'GEBCO_08 elevation and bathymetry greyscales from Blue Marble Next Generation'},
            'mask_4k.webp': {'size': [4096, 2048], 'channels': 'one: 255 land (incl. ice sheets and lakes below '
                             'the bathymetry\'s reach), 0 ocean; lossless', 'source': 'from the GEBCO_08 bathymetry'},
        },
        'credit': 'NASA Earth Observatory: Blue Marble Next Generation (Reto Stockli, NASA Goddard); Black Marble 2016 '
                  '(Joshua Stevens, Miguel Roman, NASA GSFC, Suomi NPP); Blue Marble clouds (2002); GEBCO_08 Grid '
                  '(General Bathymetric Chart of the Oceans) via NASA',
        'terms': 'NASA imagery: public domain, credit NASA; GEBCO grid: public domain with acknowledgement',
    })


if __name__ == '__main__':
    main()
