"""Small bodies and spacecraft from JPL's Solar System Dynamics APIs.

  python -I pipeline/orbits.py     fetches into pipeline/raw/jpl/ (once), writes web/public/data/orbits/orbits.json

Voyager 1 and 2: state vectors from Horizons (horizons.api) at 2026-11-12 00:00 TDB, heliocentric (the Sun's centre,
500@10), ecliptic and mean equinox of J2000, AU and AU per day.

Ceres, Pluto, Eris, Haumea, Makemake, Sedna and comet 1P/Halley: osculating heliocentric orbital elements from the
Small-Body Database (sbdb.api), ecliptic J2000, at each orbit solution's own epoch (given).
"""
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import RAW, WEB, get, write_json  # noqa: E402

EPOCH = '2026-11-12'
CRAFT = {'Voyager 1': '-31', 'Voyager 2': '-32'}
BODIES = {'Ceres': '1', 'Pluto': '134340', 'Eris': '136199', 'Haumea': '136108', 'Makemake': '136472',
          'Sedna': '90377', 'Halley': '1P'}


def horizons(name, cmd):
    q = {'format': 'json', 'COMMAND': f"'{cmd}'", 'OBJ_DATA': "'NO'", 'MAKE_EPHEM': "'YES'",
         'EPHEM_TYPE': "'VECTORS'", 'CENTER': "'500@10'", 'START_TIME': f"'{EPOCH}'", 'STOP_TIME': "'2026-11-13'",
         'STEP_SIZE': "'1d'", 'REF_PLANE': "'ECLIPTIC'", 'REF_SYSTEM': "'J2000'", 'OUT_UNITS': "'AU-D'",
         'VEC_TABLE': "'2'", 'CSV_FORMAT': "'YES'", 'TIME_TYPE': "'TDB'"}
    path = get('https://ssd.jpl.nasa.gov/api/horizons.api?' + urlencode(q), f'jpl/horizons_{cmd}.json')
    text = json.loads(path.read_text())['result']
    row = text.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()[0]
    f = [x.strip() for x in row.split(',')]
    jd, pos, vel = float(f[0]), [float(x) for x in f[2:5]], [float(x) for x in f[5:8]]
    r = math.sqrt(sum(x * x for x in pos))
    print(f'{name}: {r:.2f} AU from the Sun, {math.sqrt(sum(v * v for v in vel)) * 1.495978707e8 / 86400:.2f} km/s')
    return {'name': name, 'horizonsId': cmd, 'epochJD_TDB': jd, 'epoch': f'{EPOCH}T00:00:00 TDB',
            'positionAU': pos, 'velocityAUperDay': vel, 'distanceAU': round(r, 4)}


def sbdb(name, sstr):
    path = get('https://ssd-api.jpl.nasa.gov/sbdb.api?' + urlencode({'sstr': sstr, 'full-prec': 'true'}),
               f'jpl/sbdb_{sstr}.json')
    d = json.loads(path.read_text())
    o = d['orbit']
    el = {e['name']: float(e['value']) for e in o['elements'] if e['value'] is not None}
    out = {'name': name, 'designation': d['object']['fullname'].strip(), 'epochJD_TDB': float(o['epoch']),
           'a_AU': el['a'], 'e': el['e'], 'i_deg': el['i'], 'node_deg': el['om'], 'peri_deg': el['w'],
           'M_deg': el.get('ma'), 'q_AU': el['q'], 'tp_JD_TDB': el['tp'], 'period_days': el.get('per'),
           'n_degPerDay': el.get('n'), 'solution': o.get('soln_date'), 'source': o.get('source')}
    print(f"{name}: a {el['a']:.3f} AU, e {el['e']:.4f}, i {el['i']:.2f} deg, P {el.get('per', 0) / 365.25:.1f} yr")
    return out


def main():
    craft = [horizons(n, c) for n, c in CRAFT.items()]
    bodies = [sbdb(n, s) for n, s in BODIES.items()]
    write_json(WEB / 'orbits' / 'orbits.json', {
        'frame': 'heliocentric (Sun centre), ecliptic and mean equinox of J2000; AU, AU/day, degrees',
        'spacecraft': {'about': f'Horizons state vectors at {EPOCH} 00:00 TDB', 'items': craft},
        'smallBodies': {'about': 'SBDB osculating elements at each solution\'s epoch: a semi-major axis, e '
                                 'eccentricity, i inclination, node longitude of ascending node, peri argument of '
                                 'perihelion, M mean anomaly at epoch, q perihelion distance, tp time of perihelion',
                        'items': bodies},
        'credit': 'JPL Solar System Dynamics: Horizons and the Small-Body Database (NASA/JPL-Caltech)',
        'terms': 'public (NASA/JPL); credit JPL Horizons / SBDB'})


if __name__ == '__main__':
    main()
