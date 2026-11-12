"""Fetch every raw file the pipeline reads (except JPL's, which orbits.py fetches, and the two USGS mosaics, which
fetch_usgs.py reads in part) into pipeline/raw/, logging each in raw/manifest.json. Already-present files are skipped.

  python -I pipeline/fetch_all.py && python -I pipeline/fetch_usgs.py

then the makers, in any order: stars.py, galaxies.py, milkyway_faceon.py, cmb.py, earth.py, moon.py, planets.py,
orbits.py; and contact_sheet.py to look at the result. See SOURCES.md for each file's terms.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import get  # noqa: E402

FILES = {
    '2mrs/meta.txt':
        'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/ApJS/199/26&-meta.all&-out.max=0',
    '2mrs/table3.tsv':
        'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/ApJS/199/26/table3&-out.max=unlimited&-out=ID,RAJ2000,DEJ2000,GLON,GLAT,Kcmag,Ktmag,type,cz,e_cz',
    'd3-celestial/LICENSE':
        'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/LICENSE',
    'd3-celestial/constellations.json':
        'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json',
    'd3-celestial/constellations.lines.json':
        'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json',
    'earth/BlackMarble_2016_3km.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
    'earth/BlackMarble_2016_3km_gray.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg',
    'earth/cloud_combined_2048.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg',
    'earth/gebco_08_rev_bath_21600x10800.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bathymetry/gebco_08_rev_bath_21600x10800.jpg',
    'earth/gebco_08_rev_elev_21600x10800.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_21600x10800.jpg',
    'earth/world.topo.bathy.200412.3x21600x10800.jpg':
        'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/december/world.topo.bathy.200412.3x21600x10800.jpg',
    'hip1997/hip_main_V8.tsv':
        'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/239/hip_main&-out.max=unlimited&Vmag=%3C8.05&-out=HIP,RAhms,DEdms,RAICRS,DEICRS,Plx,e_Plx,pmRA,pmDE,Vmag,B-V,V-I',
    'iau/IAU-CSN.txt':
        'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
    'milkyway/PIA10748.tif':
        'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia10/pia10748/PIA10748.tif',
    'milkyway/PIA10748_fig1.jpg':
        'https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia10/pia10748/figures/PIA10748_fig1.jpg',
    'milkyway/PIA10748_fig2.jpg':
        'https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia10/pia10748/figures/PIA10748_fig2.jpg',
    'moon/ldem_4.tif':
        'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4.tif',
    'moon/lroc_color_poles_4k.tif':
        'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif',
    'nearby/Comments.dat':
        'https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/Comments.dat',
    'nearby/NearbyGalaxies_Jan2021_PUBLIC.fits':
        'https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/NearbyGalaxies_Jan2021_PUBLIC.fits',
    'nearby/Update.log':
        'https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/Update.log',
    'planck/COM_CMB_IQU-smica_1024_R2.02_full.fits':
        'https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits',
    'planets/Mars_Viking_ClrMosaic_global_925m.lbl':
        'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_ClrMosaic_global_925m.lbl',
    'planets/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl':
        'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl',
    'planets/Mercury_MESSENGER_ClrMosaic_global_665m_v3_pds3.lbl':
        'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3_pds3.lbl',
    'planets/PIA07782.tif':
        'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.tif',
    'planets/opal_saturn-2024_readme.txt':
        'https://archive.stsci.edu/hlsps/opal/cycle31/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2024_all_v1_readme.txt',
    'planets/opal_saturn-2024a_rgb.tif':
        'https://archive.stsci.edu/hlsps/opal/cycle31/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2024a_f395n-f502n-f631n_v1_globalmap.tif',
    'planets/opal_saturn-2025a_rgb.tif':
        'https://archive.stsci.edu/hlsps/opal/cycle32/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif',
    'rings/DATAINFO.TXT':
        'https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/DATAINFO.TXT',
    'rings/PS1P01_10km.LBL':
        'https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM010/PS1P01.LBL',
    'rings/PS1P01_10km.TAB':
        'https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM010/PS1P01.TAB',
    'xhip/ReadMe':
        'https://vizier.cfa.harvard.edu/ftp/cats/V/137D/ReadMe',
    'xhip/biblio.dat.gz':
        'https://vizier.cfa.harvard.edu/ftp/cats/V/137D/biblio.dat.gz',
    'xhip/main.dat.gz':
        'https://vizier.cfa.harvard.edu/ftp/cats/V/137D/main.dat.gz',
    'xhip/photo.dat.gz':
        'https://vizier.cfa.harvard.edu/ftp/cats/V/137D/photo.dat.gz',
}

if __name__ == '__main__':
    for rel, url in FILES.items():
        get(url, rel)
