"""Fetch the raw pictures behind the Milky Way, Earth, Moon and planet maps (see SOURCES.md for each one's terms).

  python -I pipeline/fetch_images.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import get  # noqa: E402

EO = 'https://assets.science.nasa.gov/content/dam/science/esd/eo'
PJ = 'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia'
SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720'

FILES = {
    'milkyway/PIA10748.tif': f'{PJ}/pia10/pia10748/PIA10748.tif',
    'earth/world.topo.bathy.200412.3x21600x10800.jpg':
        f'{EO}/images/bmng/bmng-topography-bathymetry/december/world.topo.bathy.200412.3x21600x10800.jpg',
    'earth/BlackMarble_2016_3km.jpg': f'{EO}/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
    'earth/BlackMarble_2016_3km_gray.jpg': f'{EO}/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg',
    'earth/cloud_combined_2048.jpg': f'{EO}/content-feature/bluemarble/images/cloud_combined_2048.jpg',
    'earth/gebco_08_rev_elev_21600x10800.jpg': f'{EO}/images/bmng/topography/gebco_08_rev_elev_21600x10800.jpg',
    'earth/gebco_08_rev_bath_21600x10800.jpg': f'{EO}/images/bmng/bathymetry/gebco_08_rev_bath_21600x10800.jpg',
    'moon/lroc_color_poles_4k.tif': f'{SVS}/lroc_color_poles_4k.tif',
    'moon/ldem_4.tif': f'{SVS}/ldem_4.tif',
    'planets/PIA07782.tif': f'{PJ}/pia07/pia07782/PIA07782.tif',
    'planets/Mars_Viking_ClrMosaic_global_925m.lbl':
        'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_ClrMosaic_global_925m.lbl',
    'planets/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl':
        'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl',
}

if __name__ == '__main__':
    for rel, url in FILES.items():
        get(url, rel)
