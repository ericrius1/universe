"""Real galaxies for the cosmic web: the 2MASS Redshift Survey, the Local Group, a dozen named structures, and a
coarse density volume, all in one frame.

  python -I pipeline/galaxies.py     reads pipeline/raw/{2mrs,nearby}/, writes web/public/data/galaxies/

The frame: heliocentric, equatorial J2000 axes (+x to RA 0h Dec 0, +y to RA 6h Dec 0, +z the north celestial pole),
megaparsecs, the same axes as the stars (sky/), so the Milky Way's own stars and its neighbours share a direction.

2MRS (Huchra et al. 2012, ApJS 199, 26; VizieR J/ApJS/199/26 table3): 44,599 galaxies to Ks 11.75 over 91% of the sky
(it misses |b| < 5-8 deg, the zone of avoidance behind the Milky Way's disc), 43,533 with a redshift. A galaxy is placed
at its redshift distance d = v_LG / H0, H0 = 70 km/s/Mpc, where v_LG is the heliocentric cz moved to the Local Group's
frame (Courteau & van den Bergh 1999: v_LG = cz - 79 cos l cos b + 296 sin l cos b - 36 sin b). That is redshift space:
clusters stretch along the line of sight ("fingers of god") and the nearest few Mpc are wrong (peculiar velocities are as
big as the Hubble flow there). Galaxies matched to McConnachie's Local Group table get its measured distance instead;
the rest with v_LG < 70 km/s are put at 1 Mpc and flagged.

K-band luminosity: log10(L_K / L_sun) from the extinction-corrected total Ks magnitude, M_K,sun = 3.28 (Binney &
Merrifield 1998), no k-correction (z < 0.1).

Writes:
  2mrs.bin       per galaxy, brightest in K first, 20 bytes: f32 x, y, z (Mpc), f32 log10 L_K, u32 type | flags << 8
  2mrs.json      its layout
  localgroup.json  McConnachie's nearby galaxies (2012, updated Jan 2021) plus the Milky Way and M31
  structures.json  named clusters, superclusters, a void and walls, each with its source
  density.bin    128^3 bytes, log density of 2MRS smoothed and corrected for the survey's fall-off with distance
  density.json   its box and encoding
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, write_json  # noqa: E402

OUT = WEB / 'galaxies'
H0 = 70.0
MK_SUN = 3.28
TYPES = {0: 'unknown (not yet typed)', 1: 'spiral (Sa-Sm, unclassified S)', 2: 'elliptical or lenticular (E, E/S0, S0)',
         3: 'other (irregular, peculiar, compact)'}
FLAG_LG = 1    # distance from McConnachie's table, not the redshift
FLAG_NEAR = 2  # v_LG < 70 km/s, no measured distance: put at 1 Mpc
CREDIT_2MRS = ('2MASS Redshift Survey: Huchra et al. 2012, ApJS 199, 26 (VizieR J/ApJS/199/26). This publication makes '
               'use of data products from the Two Micron All Sky Survey, a joint project of the University of '
               'Massachusetts and IPAC/Caltech, funded by NASA and the NSF.')
CREDIT_LG = ('McConnachie 2012, AJ 144, 4, "The observed properties of dwarf galaxies in and around the Local Group", '
             'updated table (Jan 2021) from the CADC.')


def unit(ra, de):
    r, d = np.radians(ra), np.radians(de)
    return np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)], axis=-1)


def v_lg(cz, l, b):
    l, b = np.radians(l), np.radians(b)
    return cz - 79 * np.cos(l) * np.cos(b) + 296 * np.sin(l) * np.cos(b) - 36 * np.sin(b)


def read_2mrs():
    rows = []
    for ln in (RAW / '2mrs' / 'table3.tsv').read_text().splitlines():
        f = ln.split('\t')
        if ln.startswith('#') or len(f) < 10 or not f[1].strip()[:1].isdigit():
            continue
        rows.append(f)
    num = lambda c: np.array([float(r[c]) if r[c].strip() else np.nan for r in rows])  # noqa: E731
    t = {'id': np.array([r[0].strip() for r in rows]), 'ra': num(1), 'de': num(2), 'l': num(3), 'b': num(4),
         'kc': num(5), 'kt': num(6), 'cz': num(8)}
    tt = np.array([int(r[7][:2]) if r[7][:2].strip().lstrip('-').isdigit() else 98 for r in rows])
    t['T'] = tt
    return t


def coarse_type(T):
    out = np.zeros(len(T), np.uint32)
    out[((T >= 1) & (T <= 9)) | (T == 20)] = 1
    out[(T >= -7) & (T <= 0)] = 2
    out[np.isin(T, [10, 11, 12, 15, 16, -9])] = 3
    return out


def read_lg():
    from astropy.coordinates import SkyCoord
    from astropy.table import Table
    import astropy.units as u
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        t = Table.read(RAW / 'nearby' / 'NearbyGalaxies_Jan2021_PUBLIC.fits')
    c = SkyCoord([s.strip() for s in t['RA']], [s.strip() for s in t['Dec']], unit=(u.hourangle, u.deg))
    return t, c.ra.deg, c.dec.deg


# Types and sizes the table doesn't carry. Big galaxies: morphology and an approximate optical radius (R25-ish, kpc),
# from NED's classifications and de Vaucouleurs et al. 1991 (RC3) diameters, rounded.
BIG = {
    'MilkyWay': ('spiral', 'SBbc', 15.0), 'Andromeda': ('spiral', 'SA(s)b', 23.0), 'Triangulum': ('spiral', 'SA(s)cd', 9.0),
    'LMC': ('irregular', 'SB(s)m', 4.3), 'SMC': ('irregular', 'SB(s)m pec', 2.7), 'NGC300': ('spiral', 'SA(s)d', 6.5),
    'NGC55': ('spiral', 'SB(s)m edge-on', 9.5), 'M32': ('elliptical', 'cE2', 1.0), 'NGC205': ('elliptical', 'E5 pec (dE)', 2.5),
    'NGC147': ('elliptical', 'dE5 pec', 2.0), 'NGC185': ('elliptical', 'dE3 pec', 1.7),
    'SagittariusdSph': ('spheroidal', 'dSph', None), 'CanisMajor': ('candidate', 'stellar overdensity, disputed', None),
}


def write_localgroup():
    t, ra, de = read_lg()
    out = []
    for i, r in enumerate(t):
        name = r['GalaxyName'].strip()
        bare = name.lstrip('*')
        dmod = float(r['dmod'])
        dkpc = 10 ** (dmod / 5 + 1) / 1e3
        rh_arcmin = float(r['rh'])
        rh_pc = dkpc * 1e3 * np.tan(np.radians(rh_arcmin / 60)) if rh_arcmin < 900 else None
        mhi = float(r['MHI'])
        vmag = float(r['Vmag'])
        if bare in BIG:
            kind, morph, rkpc = BIG[bare]
        else:
            # Gas-rich dwarfs are irregulars, gas-poor ones spheroidals (McConnachie's own split, near enough).
            kind = 'irregular' if (mhi < 900 and mhi > 0.5) else 'spheroidal'
            morph, rkpc = ('dIrr' if kind == 'irregular' else 'dSph'), None
        e = {'name': bare, 'candidate': name.startswith('*'), 'ra': round(float(ra[i]), 5), 'dec': round(float(de[i]), 5),
             'distanceKpc': round(dkpc, 1), 'dmod': dmod,
             'xyzMpc': [round(float(x), 5) for x in unit(ra[i], de[i]) * dkpc / 1e3],
             'type': kind, 'morphology': morph,
             'MV': round(vmag - dmod - 3.1 * float(r['EB-V']), 2) if vmag < 900 else None,
             'halfLightRadiusPc': round(rh_pc, 1) if rh_pc else None,
             'vHelio': float(r['vh']) if float(r['vh']) < 900 else None}
        if rkpc:
            e['radiusKpc'] = rkpc
        out.append(e)
    # McConnachie dropped the Milky Way and M31 from the table in Oct 2019; these are his 2012 values (Table 2 and 4).
    m31 = {'name': 'Andromeda', 'aka': 'M31', 'candidate': False, 'ra': 10.68471, 'dec': 41.26875, 'dmod': 24.47,
           'distanceKpc': 783.0, 'type': 'spiral', 'morphology': BIG['Andromeda'][1], 'MV': -21.2,
           'halfLightRadiusPc': None, 'radiusKpc': BIG['Andromeda'][2], 'vHelio': -300.0,
           'note': 'McConnachie 2012 Table 2'}
    m31['xyzMpc'] = [round(float(x), 5) for x in unit(m31['ra'], m31['dec']) * 0.783]
    # The Galaxy: its centre is Sgr A*, 8.2 kpc away (Bland-Hawthorn & Gerhard 2016 review).
    mw = {'name': 'Milky Way', 'aka': 'the Galaxy', 'candidate': False, 'ra': 266.41683, 'dec': -29.00781,
          'distanceKpc': 8.2, 'type': 'spiral', 'morphology': BIG['MilkyWay'][1], 'MV': -20.8,
          'halfLightRadiusPc': None, 'radiusKpc': BIG['MilkyWay'][2], 'vHelio': None,
          'note': 'position is the Galactic centre (Sgr A*); the Sun is 8.2 kpc from it (Bland-Hawthorn & Gerhard 2016)'}
    mw['xyzMpc'] = [round(float(x), 5) for x in unit(mw['ra'], mw['dec']) * 0.0082]
    out = [mw, m31] + sorted(out, key=lambda e: e['distanceKpc'])
    for e in out:
        if e['name'] == 'Triangulum':
            e['aka'] = 'M33'
    write_json(OUT / 'localgroup.json', {
        'source': CREDIT_LG, 'url': 'https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/community/nearby/',
        'frame': 'heliocentric, equatorial J2000 axes, Mpc (as 2mrs.bin)',
        'fields': {'distanceKpc': 'from the distance modulus dmod', 'MV': 'absolute V, extinction-corrected (A_V = 3.1 E(B-V))',
                   'halfLightRadiusPc': 'McConnachie rh (arcmin) at its distance', 'radiusKpc':
                   'approximate optical radius for the big ones (RC3 D25/2, rounded)',
                   'type': 'spiral, elliptical, irregular (gas-rich dwarf), spheroidal (gas-poor dwarf), candidate',
                   'candidate': 'McConnachie marks it * (nature or membership not settled)'},
        'galaxies': out})
    print(f'localgroup.json: {len(out)} galaxies; M31 at {m31["distanceKpc"] / 1e3:.3f} Mpc')
    return out


def write_2mrs(lg):
    t = read_2mrs()
    has = ~np.isnan(t['cz'])
    print(f'2MRS: {len(t["cz"])} galaxies, {has.sum()} with redshifts')
    for k in t:
        t[k] = t[k][has]
    v = v_lg(t['cz'], t['l'], t['b'])
    d = v / H0
    flags = np.zeros(len(d), np.uint32)
    # Galaxies that are also in the Local Group table: its distance.
    u2 = unit(t['ra'], t['de'])
    for g in lg:
        if g['distanceKpc'] < 20:  # the Milky Way's own satellites aren't in 2MRS as galaxies at their distance
            continue
        sep = np.degrees(np.arccos(np.clip(u2 @ unit(g['ra'], g['dec']), -1, 1)))
        k = int(np.argmin(sep))
        if sep[k] < 0.1 and abs(v[k]) < 600:
            d[k] = g['distanceKpc'] / 1e3
            flags[k] |= FLAG_LG
    near = (v < H0) & (flags & FLAG_LG == 0)
    d[near] = 1.0
    flags[near] |= FLAG_NEAR
    xyz = u2 * d[:, None]
    dist_pc = d * 1e6
    logl = -0.4 * (t['kt'] - 5 * np.log10(dist_pc / 10) - MK_SUN)
    typ = coarse_type(t['T'])
    order = np.argsort(t['kt'], kind='stable')
    rec = np.zeros(len(order), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('logL', '<f4'), ('tf', '<u4')])
    rec['x'], rec['y'], rec['z'] = xyz[order].T
    rec['logL'] = logl[order]
    rec['tf'] = typ[order] | (flags[order] << 8)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / '2mrs.bin').write_bytes(rec.tobytes())
    counts = {TYPES[k]: int((typ == k).sum()) for k in TYPES}
    write_json(OUT / '2mrs.json', {
        'file': '2mrs.bin', 'count': int(len(order)), 'order': 'brightest total Ks first',
        'record': {'bytes': 20, 'littleEndian': True,
                   'fields': [['x', 'f32', 'Mpc'], ['y', 'f32', 'Mpc'], ['z', 'f32', 'Mpc'],
                              ['logLK', 'f32', 'log10 of K-band luminosity in solar units'],
                              ['typeFlags', 'u32', 'low byte: type; next byte: flags']]},
        'types': {str(k): v for k, v in TYPES.items()}, 'typeCounts': counts,
        'flags': {'1': 'distance measured (McConnachie 2012), not from the redshift',
                  '2': 'v_LG < 70 km/s with no measured distance: placed at 1 Mpc'},
        'frame': 'heliocentric, equatorial J2000 axes: +x RA 0h Dec 0, +y RA 6h Dec 0, +z north celestial pole',
        'distance': 'redshift distance v_LG / H0, H0 = 70 km/s/Mpc; v_LG per Courteau & van den Bergh 1999',
        'luminosity': 'from extinction-corrected total Ks (Ktmag), M_K,sun = 3.28',
        'coverage': 'all sky except |b| < 5 deg (|b| < 8 deg toward the bulge, l < 30 or > 330): the zone of avoidance',
        'credit': CREDIT_2MRS, 'terms': 'VizieR/CDS: free to use with acknowledgement; 2MASS acknowledgement as given'})
    print(f'2mrs.bin: {len(order)} galaxies, {flags.astype(bool).sum()} flagged ({(flags & FLAG_LG > 0).sum()} LG), '
          f'types {counts}, d max {d.max():.0f} Mpc, median {np.median(d):.0f}')
    return t, v, d, xyz


# BCG or centre of each cluster (position from the named galaxy, matched to its 2MRS entry); the cluster's velocity is
# the median cz of 2MRS galaxies within 1.5 Mpc (projected) and 2,000 km/s of it.
CLUSTERS = [
    ('Virgo Cluster', 'cluster', 187.7059, 12.3911, 'M87 (NGC 4486)', 'Binggeli, Sandage & Tammann 1985, AJ 90, 1681; '
     'measured distance 16.5 Mpc from surface-brightness fluctuations (Mei et al. 2007, ApJ 655, 144)', 16.5),
    ('Fornax Cluster', 'cluster', 54.6212, -35.4507, 'NGC 1399', 'Ferguson 1989, AJ 98, 367; SBF distance 20.0 Mpc '
     '(Blakeslee et al. 2009, ApJ 694, 556)', 20.0),
    ('Centaurus Cluster (Abell 3526)', 'cluster', 192.2051, -41.3112, 'NGC 4696', 'Lucey, Currie & Dickens 1986, MNRAS '
     '221, 453', None),
    ('Hydra Cluster (Abell 1060)', 'cluster', 159.1779, -27.5285, 'NGC 3311', 'Richter 1987, A&AS 67, 237', None),
    ('Perseus Cluster (Abell 426)', 'cluster', 49.9507, 41.5117, 'NGC 1275', 'Abell, Corwin & Olowin 1989, ApJS 70, 1; '
     'heart of the Perseus-Pisces supercluster (Haynes & Giovanelli 1986)', None),
    ('Norma Cluster (Abell 3627)', 'cluster', 243.7660, -60.9070, 'ESO 137-G006', 'Kraan-Korteweg et al. 1996, Nature '
     '379, 519: the core of the Great Attractor', None),
    ('Coma Cluster (Abell 1656)', 'cluster', 194.8988, 27.9594, 'NGC 4874', 'Abell, Corwin & Olowin 1989; centre of '
     'the CfA2 Great Wall (Geller & Huchra 1989, Science 246, 897)', None),
    ('Hercules Cluster (Abell 2151)', 'cluster', 241.1490, 17.7215, 'NGC 6041', 'Abell, Corwin & Olowin 1989; Hercules '
     'supercluster (Einasto et al. 2001)', None),
    ('Shapley Supercluster core (Abell 3558)', 'supercluster', 201.9870, -31.4955, 'ESO 444-G046', 'Shapley 1930; '
     'Raychaudhury 1989, Nature 342, 251; the largest concentration of mass within 200 Mpc', None),
]
# Structures without a single centre galaxy: literature positions (approximate; their extents are given).
LITERATURE = [
    {'name': 'Bootes Void', 'kind': 'void', 'ra': 222.5, 'dec': 46.0, 'cz': 15500, 'radiusMpc': 50,
     'source': 'Kirshner, Oemler, Schechter & Shectman 1981, ApJ 248, L57; Kirshner et al. 1987, ApJ 314, 493 '
               '(centre ~14h50m +46 deg, cz ~15,500 km/s, radius ~62/h Mpc)'},
    {'name': 'Sloan Great Wall', 'kind': 'wall', 'ra': 195.0, 'dec': 1.0, 'cz': 22000, 'lengthMpc': 420,
     'source': 'Gott et al. 2005, ApJ 624, 463 (SDSS slice at Dec ~0, RA ~9h-15h, z ~0.07-0.08; 1.37 billion ly long)'},
    {'name': 'CfA2 Great Wall', 'kind': 'wall', 'ra': 195.0, 'dec': 29.0, 'cz': 7000, 'lengthMpc': 200,
     'source': 'Geller & Huchra 1989, Science 246, 897 (RA ~8h-17h, Dec ~+27 to +40, cz ~5,000-10,000 km/s)'},
]


def write_structures(t, v, d):
    u2 = unit(t['ra'], t['de'])
    out = []
    for name, kind, ra, de, bcg, src, dmeas in CLUSTERS:
        sep = np.degrees(np.arccos(np.clip(u2 @ unit(ra, de), -1, 1)))
        k = int(np.argmin(sep))
        assert sep[k] < 0.05, (name, sep[k])
        d0 = max(v[k], 300) / H0
        within = (np.radians(sep) * d0 < 1.5) & (np.abs(t['cz'] - t['cz'][k]) < 2000)
        vc = float(np.median(v[within]))
        dist = vc / H0
        e = {'name': name, 'kind': kind, 'centre': bcg, 'ra': ra, 'dec': de, 'vLG': round(vc), 'members2MRS': int(within.sum()),
             'redshiftDistanceMpc': round(dist, 2), 'xyzMpc': [round(float(x), 3) for x in unit(ra, de) * dist],
             'source': src}
        if dmeas:
            e['measuredDistanceMpc'] = dmeas
        out.append(e)
    for s in LITERATURE:
        cz = s['cz']
        from astropy.coordinates import SkyCoord
        import astropy.units as u
        g = SkyCoord(s['ra'] * u.deg, s['dec'] * u.deg).galactic
        vl = float(v_lg(cz, g.l.deg, g.b.deg))
        e = dict(s, vLG=round(vl), redshiftDistanceMpc=round(vl / H0, 1),
                 xyzMpc=[round(float(x), 2) for x in unit(s['ra'], s['dec']) * vl / H0], approximate=True)
        out.append(e)
    write_json(OUT / 'structures.json', {
        'frame': 'heliocentric, equatorial J2000 axes, Mpc, redshift distance v_LG / 70 (as 2mrs.bin)',
        'note': 'Clusters: centred on the named galaxy, at the median v_LG of the 2MRS galaxies within 1.5 Mpc and '
                '2,000 km/s of it. Voids and walls: approximate literature positions.',
        'structures': out})
    for e in out:
        print(f"  {e['name']}: {e['redshiftDistanceMpc']} Mpc (vLG {e['vLG']}, {e.get('members2MRS', '-')} members)")


def write_density(xyz, d):
    """Counts in 128^3 cells over a 400 Mpc box, each galaxy weighted by 1/selection(d), smoothed, logged."""
    N, half = 128, 200.0
    cell = 2 * half / N
    ok = (d > 2) & (d < half)
    # Selection: the survey's number density by distance (shells of 5 Mpc, smoothed), normalised to its peak.
    edges = np.arange(0, half + 5, 5.0)
    n, _ = np.histogram(d[ok], edges)
    vol = 4 / 3 * np.pi * (edges[1:] ** 3 - edges[:-1] ** 3) * 0.91  # 91% of the sky
    phi = gaussian_filter(n / vol, 1.0)
    phi_d = np.interp(d[ok], 0.5 * (edges[1:] + edges[:-1]), phi)
    w = 1.0 / np.maximum(phi_d, phi.max() * 0.05)
    idx = np.floor((xyz[ok] + half) / cell).astype(int)
    grid = np.zeros((N, N, N))
    np.add.at(grid, (idx[:, 2], idx[:, 1], idx[:, 0]), w)  # [z][y][x], x fastest in memory
    sm = gaussian_filter(grid, 4.0 / cell)  # 4 Mpc Gaussian
    mean = sm[sm > 0].mean()
    rho = sm / mean
    lo, hi = -1.0, 1.5  # log10(rho / mean): 0.1x to ~30x the mean
    z, y, x = (np.mgrid[0:N, 0:N, 0:N] + 0.5) * cell - half
    inside = np.sqrt(x * x + y * y + z * z) < half
    val = np.clip((np.log10(np.maximum(rho, 1e-6)) - lo) / (hi - lo), 0, 1)
    b = np.where(inside, 1 + np.round(val * 254), 0).astype(np.uint8)
    (OUT / 'density.bin').write_bytes(b.tobytes())
    write_json(OUT / 'density.json', {
        'file': 'density.bin', 'dims': [N, N, N], 'order': 'x fastest, then y, then z (index = x + 128 (y + 128 z))',
        'boxMpc': {'min': [-half] * 3, 'max': [half] * 3}, 'cellMpc': cell,
        'frame': 'heliocentric, equatorial J2000 axes (as 2mrs.bin), redshift space',
        'encoding': 'byte 0: outside the 200 Mpc sphere; 1..255: log10(rho / mean) linear from -1.0 to 1.5 '
                    '(value = 1 + 254 * (log10(rho/mean) + 1) / 2.5, clipped)',
        'method': '2MRS galaxies with 2 < d < 200 Mpc, each weighted by 1/n(d) (the survey\'s own number density by '
                  'distance, floored at 5% of its peak), binned, smoothed by a 4 Mpc Gaussian. The zone of avoidance '
                  '(|b| < 5-8 deg) is empty, and shot noise grows past ~150 Mpc.',
        'credit': CREDIT_2MRS})
    print(f'density.bin: {N}^3, occupied {(b > 1).mean() * 100:.0f}% of cells, mean byte inside {b[inside].mean():.0f}')


def main():
    lg = write_localgroup()
    t, v, d, xyz = write_2mrs(lg)
    write_structures(t, v, d)
    write_density(xyz, d)


if __name__ == '__main__':
    main()
