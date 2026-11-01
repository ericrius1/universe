"""Real molecules for the cell: mmCIF structures from the RCSB Protein Data Bank, coarse-grained to beads.

  python -I pipeline/beads.py [ids...]   fetch what's missing into pipeline/pdb/, write web/public/data/mol/*.bin + index.json

Each residue (amino acid) becomes one bead at the centroid of its heavy atoms, each nucleotide two (backbone, base),
with a radius from its atom count (~18 Å^3 per heavy atom). Two coarser levels of detail are k-means clusters of
those beads (~1/20 and ~1/300 as many: a distant molecule reads as a few soft lumps, not dust), each cluster a sphere that roughly covers its members. Coordinates are in nm.
A bead carries a group: its chain, which the app colours by (index.json names each one).

Framing: most molecules are centred on their centroid. Membrane proteins are turned so the membrane's normal is +Y
(pointing to the side with fewer Lys/Arg beside the membrane: outside, by the positive-inside rule) with the origin
mid-membrane; ATP synthase so its c-ring axis is +Y, toward the F1 head, with the ring's centre at the origin.

Binary layout (little endian): u32 magic 'BEAD', u32 levels, then per level: u32 count, count x (f32 x, y, z, r),
count x u16 group (padded to 4 bytes).
"""
import gzip
import json
import re
import struct
import sys
import urllib.request
from pathlib import Path

import numpy as np
from scipy.cluster.vq import kmeans2

ROOT = Path(__file__).resolve().parent
PDB = ROOT / 'pdb'
OUT = ROOT.parent / 'web' / 'public' / 'data' / 'mol'

# id -> (PDB entry, framing: None | 'membrane' | 'rotor')
MOLECULES = {
    'nucleosome': ('1KX5', None),
    'ribosome': ('4UG0', None),
    'atpsynthase': ('6ZPO', 'rotor'),
    'tubulin': ('1JFF', None),
    'polymerase': ('5FLM', None),
    'trna': ('1EHZ', None),
    'gapdh': ('1U8F', None),
    'proteasome': ('4R3O', None),
    'calmodulin': ('1CLL', None),
    'gfp': ('1EMA', None),
    'ubiquitin': ('1UBQ', None),
    'actin': ('1J6Z', None),
    'hexokinase': ('1HKB', None),
    'ferritin': ('1FHA', None),
    'citratesynthase': ('1CTS', None),
    'albumin': ('1AO6', None),
    'antibody': ('1IGT', None),
    'cytc': ('1HRC', None),
    'gpcr': ('3SN6', 'membrane'),
    'nakatpase': ('4HYT', 'membrane'),
    'glut1': ('4PYP', 'membrane'),
    'vdac': ('3EMN', 'membrane'),
    'complex1': ('5LDW', 'membrane'),
    'complex4': ('1OCC', 'membrane'),
    'spike': ('6VXX', None),
}

AA = set('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL MSE SEC PYL'.split())
NT_RNA = set('A C G U PSU 5MC 7MG 1MA 2MG M2G OMC OMG H2U 5MU YYG'.split())
NT_DNA = set('DA DC DG DT'.split())
BACKBONE_NT = set("P OP1 OP2 OP3 O5' C5' C4' O4' C3' O3' C2' O2' C1'".split())
HYDROPHOBIC = set('LEU ILE VAL PHE MET ALA TRP'.split())
POSITIVE = set('LYS ARG'.split())
CHARGED = set('ASP GLU LYS ARG'.split())


def fetch(code):
    PDB.mkdir(parents=True, exist_ok=True)
    path = PDB / f'{code}.cif.gz'
    if not path.exists():
        url = f'https://files.rcsb.org/download/{code}.cif.gz'
        print('fetch', url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as r:
            path.write_bytes(r.read())
    return path


# an mmCIF token: a quoted string (a quote closes it only when whitespace follows) or a bare word
TOKEN = re.compile(r"""'(?:[^']|'(?=\S))*'|"(?:[^"]|"(?=\S))*"|\S+""")


def unquote(t):
    return t[1:-1] if len(t) > 1 and t[0] == t[-1] and t[0] in '\'"' else t


def text_field(lines, i):
    """a ;-delimited text field starting at line i: (text, index of the line after it)"""
    text = [lines[i][1:]]
    i += 1
    while i < len(lines) and not lines[i].startswith(';'):
        text.append(lines[i])
        i += 1
    return ' '.join(text).strip(), i + 1


def categories(path, wanted):
    """the mmCIF categories named in `wanted`, looped or not: {category: (columns, rows of values)}"""
    lines = gzip.open(path, 'rt', encoding='utf-8', errors='replace').read().splitlines()
    out, i = {}, 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('loop_') and i + 1 < len(lines) and lines[i + 1].split('.', 1)[0] in wanted:
            cat = lines[i + 1].split('.', 1)[0]
            i += 1
            cols = []
            while i < len(lines) and lines[i].startswith(cat + '.'):
                cols.append(lines[i].split('.', 1)[1].strip())
                i += 1
            toks = []
            while i < len(lines) and not lines[i].startswith(('#', 'loop_', '_')):
                if lines[i].startswith(';'):
                    t, i = text_field(lines, i)
                    toks.append(t)
                    continue
                toks += [unquote(t) for t in TOKEN.findall(lines[i])]
                i += 1
            n = len(cols)
            out[cat] = (cols, [toks[k:k + n] for k in range(0, len(toks) - n + 1, n)])
            continue
        head = line.split('.', 1)[0] if line.startswith('_') else None
        if head in wanted and head not in out:
            cols, vals = [], []
            while i < len(lines) and lines[i].startswith(head + '.'):
                f = TOKEN.findall(lines[i])
                cols.append(f[0].split('.', 1)[1])
                if len(f) > 1:
                    vals.append(unquote(' '.join(f[1:])))
                    i += 1
                elif i + 1 < len(lines) and lines[i + 1].startswith(';'):
                    t, i = text_field(lines, i + 1)
                    vals.append(t)
                else:
                    vals.append(unquote(lines[i + 1].strip()))
                    i += 2
            out[head] = (cols, [vals])
            continue
        i += 1
    return out


def atoms(path):
    """the first model's heavy atoms: (chain, resseq, icode, resname, atomname, x, y, z, entity), and entity names"""
    cats = categories(path, {'_atom_site', '_entity'})
    cols, rows = cats['_atom_site']
    c = {n: k for k, n in enumerate(cols)}
    ents = {}
    if '_entity' in cats:
        ec, er = cats['_entity']
        e = {n: k for k, n in enumerate(ec)}
        for r in er:
            ents[r[e['id']]] = r[e['pdbx_description']] if 'pdbx_description' in e else ''
    out, model0 = [], None
    for f in rows:
        if 'pdbx_PDB_model_num' in c:
            m = f[c['pdbx_PDB_model_num']]
            model0 = model0 or m
            if m != model0:
                continue
        if f[c['type_symbol']] in ('H', 'D'):
            continue
        if 'label_alt_id' in c and f[c['label_alt_id']] not in ('.', '?', 'A'):
            continue
        chain = f[c['auth_asym_id']] if 'auth_asym_id' in c else f[c['label_asym_id']]
        out.append((chain, f[c['auth_seq_id']], f[c['pdbx_PDB_ins_code']] if 'pdbx_PDB_ins_code' in c else '?',
                    f[c['label_comp_id']], f[c['label_atom_id']],
                    float(f[c['Cartn_x']]), float(f[c['Cartn_y']]), float(f[c['Cartn_z']]), f[c['label_entity_id']]))
    return out, ents


def coarse(rows, ents):
    """beads (n x 4, Å), their groups (one per chain), each bead's residue name, and per group (kind, chain, entity name)"""
    beads, groups, names, info = [], [], [], []
    chains, res, order = {}, {}, []
    for ch, seq, ic, name, an, x, y, z, ent in rows:
        key = (ch, seq, ic)
        if key not in res:
            res[key] = (name, [], ent)
            order.append(key)
        res[key][1].append((an, x, y, z))
    for key in order:
        name, at, ent = res[key]
        ch = key[0]
        if name in AA:
            kind, parts = 'protein', [at]
        elif name in NT_RNA or name in NT_DNA:
            kind = 'dna' if name in NT_DNA else 'rna'
            bb = [a for a in at if a[0] in BACKBONE_NT]
            base = [a for a in at if a[0] not in BACKBONE_NT]
            parts = [q for q in (bb, base) if q]
        else:
            continue  # waters, ligands, ions
        if ch not in chains:
            chains[ch] = len(chains)
            info.append((kind, ch, ents.get(ent, '')))
        for q in parts:
            xyz = np.array([a[1:] for a in q])
            beads.append([*xyz.mean(0), 1.63 * len(q) ** (1 / 3)])
            groups.append(chains[ch])
            names.append(name)
    return np.array(beads, dtype=np.float64), np.array(groups), np.array(names), info


def fib_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def membrane_frame(b, names):
    """the membrane's normal and offset: the ~3 nm slab where hydrophobic residues gather and charged ones don't"""
    xyz = b[:, :3]
    hyd = np.isin(names, list(HYDROPHOBIC)).astype(float)
    chg = np.isin(names, list(CHARGED)).astype(float)
    best = (-1e9, None, 0.0)
    for d in fib_sphere(1500):
        if d[1] < 0:
            continue
        t = xyz @ d
        for c in np.arange(t.min() + 10, t.max() - 10, 1.0):
            inside = np.abs(t - c) < 15
            score = (hyd * inside).sum() - 2.5 * (chg * inside).sum()
            if score > best[0]:
                best = (score, d, c)
    _, d, c = best
    t = xyz @ d - c
    pos = np.isin(names, list(POSITIVE))
    up = (pos & (t > 15) & (t < 30)).sum()
    down = (pos & (t < -15) & (t > -30)).sum()
    if up > down:
        d, c = -d, -c
    return d, c


def frame_to(b, up, origin):
    """move `origin` to 0 and turn `up` to +Y"""
    up = up / np.linalg.norm(up)
    a = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 0, 1.0])
    x = np.cross(up, a)
    x /= np.linalg.norm(x)
    z = np.cross(x, up)
    out = b.copy()
    out[:, :3] = (b[:, :3] - origin) @ np.stack([x, up, z]).T
    return out


def cluster(b, g, k):
    """k spheres covering the beads; each takes the group most of its members have"""
    if len(b) <= k:
        return b.copy(), g.copy()
    rng = np.random.default_rng(7)
    _, lab = kmeans2(b[:, :3], k, minit='++', seed=rng)
    out, og = [], []
    for j in range(k):
        m = lab == j
        if not m.any():
            continue
        pts = b[m]
        c = pts[:, :3].mean(0)
        d = np.linalg.norm(pts[:, :3] - c, axis=1) + pts[:, 3]
        # (a sphere reaching the farthest member looks bloated: the 80th percentile reads as the same blob)
        r = max(np.percentile(d, 80), pts[:, 3].max())
        out.append([*c, r])
        og.append(np.bincount(g[m]).argmax())
    return np.array(out), np.array(og)


def write(path, levels):
    buf = bytearray(struct.pack('<4sI', b'BEAD', len(levels)))
    for b, g in levels:
        buf += struct.pack('<I', len(b))
        buf += np.asarray(b, dtype='<f4').tobytes()
        gb = np.asarray(g, dtype='<u2').tobytes()
        buf += gb + b'\0' * ((4 - len(gb) % 4) % 4)
    path.write_bytes(bytes(buf))


def main(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text()) if (only and index_path.exists()) else {}
    for mid, (code, how) in MOLECULES.items():
        if only and mid not in only:
            continue
        try:
            rows, ents = atoms(fetch(code))
        except Exception as e:  # a missing entry shouldn't stop the rest
            print('skip', mid, code, repr(e))
            continue
        b, g, names, info = coarse(rows, ents)
        if not len(b):
            print('skip', mid, 'no residues')
            continue
        extra = {}

        def named(*words):
            return [i for i, (k, ch, n) in enumerate(info) if any(w in n.lower() for w in words)]
        if how == 'rotor':
            # the rotor (c-ring + the central stalk γδε) is long along its axis, so its largest principal axis is the
            # axis of rotation (the c-ring alone is about as tall as it is wide); +Y points to the F1 head, and the
            # origin sits mid-membrane: the centre of the rotor's lowest 30% (the c-ring)
            rotor = named('subunit c', 'gamma', 'delta', 'epsilon')
            rot = np.isin(g, rotor)
            head = np.isin(g, named('alpha', 'beta'))
            c0 = b[rot, :3].mean(0)
            axis = np.linalg.svd(b[rot, :3] - c0, full_matrices=False)[2][0]
            if (b[head, :3].mean(0) - c0) @ axis < 0:
                axis = -axis
            t = (b[rot, :3] - c0) @ axis
            low = b[rot, :3][t <= np.percentile(t, 30)]
            b = frame_to(b, axis, low.mean(0))
            extra['rotor'] = rotor
        elif how == 'membrane':
            d, c = membrane_frame(b, names)
            b = frame_to(b, d, d * c)
            b[:, [0, 2]] -= b[:, [0, 2]].mean(0)
        else:
            b[:, :3] -= b[:, :3].mean(0)
        b /= 10.0  # Å -> nm
        n = len(b)
        dna = [i for i, (k, ch, nm) in enumerate(info) if k == 'dna']
        if dna:
            extra['dnaEnds'] = []
            for gi in dna:
                idx = np.where(g == gi)[0]
                extra['dnaEnds'].append([b[idx[0], :3].round(3).tolist(), b[idx[-1], :3].round(3).tolist()])
        l1 = cluster(b, g, max(6, n // 20))
        l2 = cluster(b, g, max(3, n // 300))
        write(OUT / f'{mid}.bin', [(b, g), l1, l2])
        rmax = b[:, 3].max()
        index[mid] = {
            'pdb': code, 'beads': [n, len(l1[0]), len(l2[0])],
            'radius': round(float(np.linalg.norm(b[:, :3], axis=1).max() + rmax), 2),
            'min': [round(float(v - rmax), 2) for v in b[:, :3].min(0)],
            'max': [round(float(v + rmax), 2) for v in b[:, :3].max(0)],
            'groups': [{'kind': k, 'chain': ch, 'name': nm} for k, ch, nm in info],
            **extra,
        }
        print(f'{mid:15s} {code} beads {n:6d} {len(l1[0]):5d} {len(l2[0]):4d} groups {len(info):3d} '
              f'r {index[mid]["radius"]:.1f} nm', flush=True)
        index_path.write_text(json.dumps(index, indent=1))


if __name__ == '__main__':
    main(set(sys.argv[1:]) or None)
