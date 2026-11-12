# Where the data come from

Every file under `web/public/data/{sky,galaxies,cmb,globe,moon,planets,orbits}/` is made by a script in `pipeline/`
from raw downloads kept in `pipeline/raw/` (not in git). This page says, for each source, what it is, its terms and the
credit it asks for; the table at the end lists every raw file with its exact URL, the date fetched and its size (it is
`python -I pipeline/fetch.py`, the download log, pasted).

To rebuild: `python -I pipeline/fetch_all.py && python -I pipeline/fetch_usgs.py`, then any of `stars.py`,
`galaxies.py`, `milkyway_faceon.py`, `cmb.py`, `earth.py`, `moon.py`, `planets.py`, `orbits.py` (which fetches its own
JPL files), and `contact_sheet.py <dir>` to look. Python 3.12 with numpy, scipy, pillow, astropy, healpy, tifffile and
imagecodecs (`pipeline/.venv`).

## By source

| source | used for | terms | credit line |
|---|---|---|---|
| XHIP, Extended Hipparcos Compilation (Anderson & Francis 2012), VizieR V/137D, via the CfA mirror | `sky/stars6.bin`, `stars8.bin` | VizieR/CDS: free to use; acknowledge the catalogue and CDS | "XHIP: Anderson & Francis 2012, Astronomy Letters 38, 331, from the Hipparcos new reduction (van Leeuwen 2007, ESA). This research has made use of the VizieR catalogue access tool, CDS, Strasbourg." |
| Hipparcos main catalogue (ESA 1997), VizieR I/239 | 19 stars to V 8 that XHIP lacks (no astrometric solution; e.g. xi UMa) | as above | "ESA 1997, The Hipparcos and Tycho Catalogues, ESA SP-1200" |
| IAU Catalog of Star Names (IAU-CSN), WGSN; file published by the WGSN secretary (E. Mamajek) | `sky/names.json` | the file states IAU products are CC BY (attribution, not share-alike) | "IAU Working Group on Star Names (WGSN), IAU Catalog of Star Names" |
| d3-celestial (Olaf Frohn), `data/constellations.lines.json`, `constellations.json` | `sky/lines.json` | BSD 3-Clause | "Constellation figures: d3-celestial, (c) 2015 Olaf Frohn, BSD 3-Clause License" (keep the licence text with any redistribution of the derived file) |
| 2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26), VizieR J/ApJS/199/26 table3 | `galaxies/2mrs.bin`, `density.bin`, cluster positions in `structures.json` | VizieR/CDS: free with acknowledgement; 2MASS asks for its acknowledgement | "Huchra et al. 2012. This publication makes use of data products from the Two Micron All Sky Survey, a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the NSF." |
| Local Group and nearby dwarf galaxies (McConnachie 2012, AJ 144, 4; updated table Jan 2021), CADC | `galaxies/localgroup.json` | **no licence stated** on the page; published research compilation, used with citation | "McConnachie 2012, AJ 144, 4 (updated data, CADC)" |
| Literature positions (cited per entry in the file) | `galaxies/structures.json` voids and walls; Virgo/Fornax measured distances; Milky Way and M31 hand values | facts, cited | per entry |
| NASA/JPL-Caltech, PIA10748 "Our Milky Way Gets a Makeover" (R. Hurt, SSC), 2008, and its labelled figure 1 | `sky/milkyway_faceon.webp`, `milkyway_dust.webp` (derived) | JPL image use policy: free to use, credit required; it is an artist's concept | "NASA/JPL-Caltech/R. Hurt (SSC)" |
| Planck 2015 SMICA CMB map, `COM_CMB_IQU-smica_1024_R2.02_full.fits`, IRSA Planck archive | `cmb/smica_4k.webp` (rendered here; not ESA's picture) | ESA Planck data: free to use with the Planck acknowledgement | "Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission with instruments and contributions directly funded by ESA Member States, NASA, and Canada." |
| NASA Earth Observatory, Blue Marble Next Generation, December 2004, topography and bathymetry (R. Stöckli) | `globe/day_8k.webp`, `day_4k.webp` | NASA: public domain | "NASA Earth Observatory, Blue Marble: Next Generation (Reto Stöckli, NASA GSFC)" |
| NASA Earth Observatory, Black Marble 2016 (greyscale; the colour version was fetched and not used) | `globe/night_4k.webp` | NASA: public domain | "NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC" |
| NASA Earth Observatory, original Blue Marble (2002) combined cloud map | `globe/clouds_2k.webp` | NASA: public domain | "NASA Goddard Space Flight Center, Blue Marble (Reto Stöckli)" |
| GEBCO_08 elevation and bathymetry greyscales as served with Blue Marble NG | `globe/relief_4k.webp`, `mask_4k.webp` (derived) | GEBCO grid: public domain, acknowledge GEBCO; NASA rendering public domain | "GEBCO_08 Grid, www.gebco.net; NASA Earth Observatory" |
| NASA SVS 4720, CGI Moon Kit (Ernie Wright): `lroc_color_poles_4k.tif`, `ldem_4.tif` | `moon/color_4k.webp`, `height_1440.png` | NASA SVS: public domain | "NASA's Scientific Visualization Studio; LRO LROC and LOLA teams" |
| USGS Astrogeology: Mercury MESSENGER MDIS colour mosaic 665 m v3; Mars Viking MDIM 2.1 colourised mosaic 925 m | `planets/mercury_2k.webp`, `mars_2k.webp` | USGS/NASA: public domain | "NASA/JHUAPL/Carnegie Institution of Washington; USGS Astrogeology" and "NASA/JPL/USGS" |
| NASA/JPL/Space Science Institute, PIA07782, Cassini's best maps of Jupiter (cylindrical), Dec 2000 | `planets/jupiter_2k.webp` | JPL image use policy: free, credit required | "NASA/JPL/Space Science Institute" |
| Hubble OPAL (Simon et al.), MAST High Level Science Product, Saturn 2025a F631N/F502N/F395N colour map | `planets/saturn_2k.webp` | HLSP: free to use with OPAL's acknowledgement (MAST is NASA's archive at STScI; STScI material is generally public domain unless noted) | "NASA, ESA, A. Simon (GSFC), OPAL. This work used data acquired from the NASA/ESA HST Space Telescope, associated with OPAL program (PI: Simon, GO13937), and archived by the Space Telescope Science Institute, which is operated by the Association of Universities for Research in Astronomy, Inc., under NASA contract NAS 5-26555. doi:10.17909/T9G593" |
| Voyager 2 PPS delta Sco ring occultation, PDS Ring-Moon Systems Node VG_2801 (EASYDATA KM010) | `planets/saturn_rings_tau.bin` | NASA PDS: public domain | "NASA/JPL, Voyager PPS team; PDS Ring-Moon Systems Node" |
| JPL Solar System Dynamics: Horizons API, Small-Body Database API | `orbits/orbits.json` | NASA/JPL: public | "JPL Horizons / JPL Small-Body Database, NASA/JPL-Caltech" |

## Notes and gaps

- **VizieR**: `tapvizier.cds.unistra.fr` and `cdsarc.cds.unistra.fr` timed out from here; the CfA mirror (`vizier.cfa.harvard.edu`) answered every query.
- **Star names**: the WGSN file is dated 2022-04-04; names adopted since (2023-2026 rounds) are not in it. 411 of its names have a Hipparcos number in the catalogue.
- **Clouds**: NASA no longer serves the 8192 x 4096 Blue Marble cloud map (old `eoimages.gsfc.nasa.gov` times out; the asset host has only `cloud_combined_2048.jpg`), so the clouds ship at 2048 x 1024, not enlarged.
- **Mars and Mercury**: the USGS originals are ~800 MB each (over the 450 MB cap): `Mars_Viking_ClrMosaic_global_925m.tif` (797,888,177 bytes) and `Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif` (797,507,691 bytes). They are uncompressed, so `fetch_usgs.py` read 4 rows per output row by HTTP range requests (about a third of each crossed the network) and kept only a 2048 x 1024 reduction.
- **Saturn**: no Cassini global colour map of Saturn exists on the Photojournal; Hubble OPAL's is used. Its rings' band and polar caps are filled (listed in `planets.json`), and it ships at its native 1800 x 900.
- **Saturn's rings**: only opacity (normal optical depth) shipped; no public-domain radial *colour* profile was assembled.
- **Venus, Uranus, Neptune**: no maps made (Venus's clouds have no free, honest global colour map; Uranus and Neptune are near featureless and OPAL's would be the only source).
- **Not used**: ESA's ready-made Planck images (CC BY-SA IGO) and the HYG database (CC BY-SA) are share-alike and were avoided.

## Every raw file

| local file | url | fetched | bytes |
|---|---|---|---|
| 2mrs/meta.txt | https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/ApJS/199/26&-meta.all&-out.max=0 | 2026-11-12 | 9,566 |
| 2mrs/table3.tsv | https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/ApJS/199/26/table3&-out.max=unlimited&-out=ID,RAJ2000,DEJ2000,GLON,GLAT,Kcmag,Ktmag,type,cz,e_cz | 2026-11-12 | 3,879,677 |
| d3-celestial/LICENSE | https://raw.githubusercontent.com/ofrohn/d3-celestial/master/LICENSE | 2026-11-12 | 1,480 |
| d3-celestial/constellations.json | https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json | 2026-11-12 | 50,581 |
| d3-celestial/constellations.lines.json | https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json | 2026-11-12 | 27,136 |
| earth/BlackMarble_2016_3km.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg | 2026-11-12 | 8,106,233 |
| earth/BlackMarble_2016_3km_gray.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg | 2026-11-12 | 3,064,569 |
| earth/cloud_combined_2048.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg | 2026-11-12 | 829,367 |
| earth/gebco_08_rev_bath_21600x10800.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bathymetry/gebco_08_rev_bath_21600x10800.jpg | 2026-11-12 | 23,093,290 |
| earth/gebco_08_rev_elev_21600x10800.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_21600x10800.jpg | 2026-11-12 | 14,107,764 |
| earth/world.topo.bathy.200412.3x21600x10800.jpg | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/december/world.topo.bathy.200412.3x21600x10800.jpg | 2026-11-12 | 29,868,040 |
| hip1997/hip_main_V8.tsv | https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/239/hip_main&-out.max=unlimited&Vmag=%3C8.05&-out=HIP,RAhms,DEdms,RAICRS,DEICRS,Plx,e_Plx,pmRA,pmDE,Vmag,B-V,V-I | 2026-11-12 | 4,683,215 |
| iau/IAU-CSN.txt | https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt | 2026-11-12 | 71,800 |
| jpl/horizons_-31.json | https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=%27-31%27&OBJ_DATA=%27NO%27&MAKE_EPHEM=%27YES%27&EPHEM_TYPE=%27VECTORS%27&CENTER=%27500%4010%27&START_TIME=%272026-11-12%27&STOP_TIME=%272026-11-13%27&STEP_SIZE=%271d%27&REF_PLANE=%27ECLIPTIC%27&REF_SYSTEM=%27J2000%27&OUT_UNITS=%27AU-D%27&VEC_TABLE=%272%27&CSV_FORMAT=%27YES%27&TIME_TYPE=%27TDB%27 | 2026-11-12 | 5,349 |
| jpl/horizons_-32.json | https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=%27-32%27&OBJ_DATA=%27NO%27&MAKE_EPHEM=%27YES%27&EPHEM_TYPE=%27VECTORS%27&CENTER=%27500%4010%27&START_TIME=%272026-11-12%27&STOP_TIME=%272026-11-13%27&STEP_SIZE=%271d%27&REF_PLANE=%27ECLIPTIC%27&REF_SYSTEM=%27J2000%27&OUT_UNITS=%27AU-D%27&VEC_TABLE=%272%27&CSV_FORMAT=%27YES%27&TIME_TYPE=%27TDB%27 | 2026-11-12 | 5,349 |
| jpl/sbdb_1.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&full-prec=true | 2026-11-12 | 2,168 |
| jpl/sbdb_134340.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=134340&full-prec=true | 2026-11-12 | 2,051 |
| jpl/sbdb_136108.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=136108&full-prec=true | 2026-11-12 | 2,181 |
| jpl/sbdb_136199.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=136199&full-prec=true | 2026-11-12 | 2,174 |
| jpl/sbdb_136472.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=136472&full-prec=true | 2026-11-12 | 2,180 |
| jpl/sbdb_1P.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1P&full-prec=true | 2026-11-12 | 2,722 |
| jpl/sbdb_90377.json | https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=90377&full-prec=true | 2026-11-12 | 2,166 |
| milkyway/PIA10748.tif | https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia10/pia10748/PIA10748.tif | 2026-11-12 | 94,080,223 |
| milkyway/PIA10748_fig1.jpg | https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia10/pia10748/figures/PIA10748_fig1.jpg | 2026-11-12 | 260,440 |
| milkyway/PIA10748_fig2.jpg | https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia10/pia10748/figures/PIA10748_fig2.jpg | 2026-11-12 | 189,735 |
| moon/ldem_4.tif | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4.tif | 2026-11-12 | 4,153,352 |
| moon/lroc_color_poles_4k.tif | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif | 2026-11-12 | 13,095,388 |
| nearby/Comments.dat | https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/Comments.dat | 2026-11-12 | 4,730 |
| nearby/NearbyGalaxies_Jan2021_PUBLIC.fits | https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/NearbyGalaxies_Jan2021_PUBLIC.fits | 2026-11-12 | 60,480 |
| nearby/Update.log | https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/Update.log | 2026-11-12 | 7,972 |
| planck/COM_CMB_IQU-smica_1024_R2.02_full.fits | https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits | 2026-11-12 | 176,209,920 |
| planets/Mars_Viking_ClrMosaic_global_925m.lbl | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_ClrMosaic_global_925m.lbl | 2026-11-12 | 1,294 |
| planets/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.lbl | 2026-11-12 | 1,673 |
| planets/Mercury_MESSENGER_ClrMosaic_global_665m_v3_pds3.lbl | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3_pds3.lbl | 2026-11-12 | 2,545 |
| planets/PIA07782.tif | https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.tif | 2026-11-12 | 19,456,427 |
| planets/mars_viking_clr_925m_2048.png | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_ClrMosaic_global_925m.tif | 2026-11-12 | 2,530,487 |
| planets/mercury_messenger_clr_665m_v3_2048.png | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif | 2026-11-12 | 4,139,883 |
| planets/opal_saturn-2024_readme.txt | https://archive.stsci.edu/hlsps/opal/cycle31/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2024_all_v1_readme.txt | 2026-11-12 | 1,703 |
| planets/opal_saturn-2024a_rgb.tif | https://archive.stsci.edu/hlsps/opal/cycle31/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2024a_f395n-f502n-f631n_v1_globalmap.tif | 2026-11-12 | 4,876,618 |
| planets/opal_saturn-2025a_rgb.tif | https://archive.stsci.edu/hlsps/opal/cycle32/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif | 2026-11-12 | 4,885,052 |
| rings/DATAINFO.TXT | https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/DATAINFO.TXT | 2026-11-12 | 7,529 |
| rings/PS1P01_10km.LBL | https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM010/PS1P01.LBL | 2026-11-12 | 6,585 |
| rings/PS1P01_10km.TAB | https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM010/PS1P01.TAB | 2026-11-12 | 352,550 |
| xhip/ReadMe | https://vizier.cfa.harvard.edu/ftp/cats/V/137D/ReadMe | 2026-11-12 | 20,903 |
| xhip/biblio.dat.gz | https://vizier.cfa.harvard.edu/ftp/cats/V/137D/biblio.dat.gz | 2026-11-12 | 2,152,588 |
| xhip/main.dat.gz | https://vizier.cfa.harvard.edu/ftp/cats/V/137D/main.dat.gz | 2026-11-12 | 11,163,196 |
| xhip/photo.dat.gz | https://vizier.cfa.harvard.edu/ftp/cats/V/137D/photo.dat.gz | 2026-11-12 | 7,496,876 |

The two `planets/*_2048.png` rows are the reductions fetch_usgs.py kept; their URL is the original they were read from.
