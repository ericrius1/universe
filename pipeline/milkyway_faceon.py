"""The Milky Way seen from outside: NASA/JPL-Caltech's face-on illustration (R. Hurt, SSC; PIA10748, 2008), drawn from
Spitzer's GLIMPSE survey, and a dust mask from its dark lanes.

  python -I pipeline/milkyway_faceon.py     reads pipeline/raw/milkyway/, writes web/public/data/sky/

It is an artist's concept fitted to the data (the bar and the two major arms from Spitzer star counts), not a photograph:
nobody has seen the Galaxy from outside. Say so where it is shown.

Frame (measured on the labelled version, PIA10748 fig 1, whose framing is the same): the Galactic centre is the image
centre; the Sun is straight below it, 0.195 of the image height down; galactic longitude 0 points up from the Sun, 90 to
the left (the Galaxy turns clockwise in this view, as seen from the north galactic pole). The full width is ~128,000
light years (~39 kpc; the labelled rings are 10 px per 1,000 ly on its 1280 px), to about 3%.

Writes:
  milkyway_faceon.webp   2048 x 2048 RGB
  milkyway_dust.webp     2048 x 2048, one channel: 0 clear, 255 the darkest dust lane
  milkyway_faceon.json   the frame, encodings and credit
"""
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

OUT = WEB / 'sky'
N = 2048
WIDTH_KPC = 128000 / 3261.56  # 128,000 ly


def main():
    src = tifffile.imread(RAW / 'milkyway' / 'PIA10748.tif')
    im = Image.fromarray(src).resize((N, N), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / 'milkyway_faceon.webp', 'WEBP', quality=88, method=6)

    # Dust: the lanes are thin, darker and redder than the arm light around them. Darkness relative to a ~6 px blur of
    # the luminance (in linear light), times how much redder than its surroundings the pixel is, kept where there is
    # disc light at all.
    a = np.asarray(im, np.float32) / 255.0
    lin = a ** 2.2
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    around = gaussian_filter(lum, 6.0)
    dark = np.clip(1 - lum / np.maximum(around, 1e-4), 0, 1)
    red = lin[..., 0] / np.maximum(lin[..., 2], 1e-4)
    red_around = gaussian_filter(red, 6.0)
    redder = np.clip((red - red_around) / np.maximum(red_around, 1e-3) * 2.0, 0, 1)
    disc = np.clip(around / 0.02, 0, 1)
    dust = np.clip(np.sqrt(dark * redder) * 2.2 * disc, 0, 1)
    dust = gaussian_filter(dust, 0.6)
    Image.fromarray(np.round(dust * 255).astype(np.uint8), 'L').save(OUT / 'milkyway_dust.webp', 'WEBP', quality=85,
                                                                     method=6)
    for f in ('milkyway_faceon.webp', 'milkyway_dust.webp'):
        print(f'{f}: {(OUT / f).stat().st_size / 1e6:.2f} MB')
    write_json(OUT / 'milkyway_faceon.json', {
        'files': {'milkyway_faceon.webp': '2048 x 2048 RGB, sRGB',
                  'milkyway_dust.webp': '2048 x 2048, one channel (R = G = B): 0 clear, 255 darkest lane; derived here '
                                        'from the picture\'s own dark, reddish lanes, not from a dust survey'},
        'frame': {'centre': 'Galactic centre at the image centre (u, v) = (0.5, 0.5)',
                  'sun': [0.5, 0.695], 'widthKpc': round(WIDTH_KPC, 2), 'widthLy': 128000,
                  'longitude0': 'up (-v) from the Sun; l = 90 to the left (-u)', 'viewedFrom': 'north galactic pole',
                  'accuracy': 'scale and Sun position measured from PIA10748 fig 1, about 3%'},
        'nature': 'artist\'s concept based on Spitzer data, not an image',
        'source': 'https://photojournal.jpl.nasa.gov/catalog/PIA10748',
        'credit': 'NASA/JPL-Caltech/R. Hurt (SSC)', 'terms': 'JPL image use policy: free to use with credit'})


if __name__ == '__main__':
    main()
