# The loop film's score: Suno's "As Above, So Below (loop)" (05080fe6-7624-4d35-b7c4-034fd13b6814), made for the film
# at its first length — 1970s cosmic progressive rock, a lone 12-string opening, building to its brightest two-thirds of
# the way through and easing back to the opening figure, which is where it ends (its WAV in
# ~/codeprojects/music-library/as-above-so-below-loop/full-mix.wav, 107.56 s, 64.6 bpm; or, SONG=<wav> LOOPED=1, the
# first film's fitted score, film/loop/score-src.wav, itself already round: its head laid after its end before the
# stretch so the stretch runs on through its seam). Stretched (Rubber Band, pitch kept) to the film's length plus FOLD
# seconds, and those seconds past the end folded over the head, so the music runs on through the loop's seam.
#   python3 tools/loop-score.py [frames] [fps]   (default 3235 at 30) -> ../film/loop/score-suno.wav, at about -14 LUFS
# then mux it into the encoded film: ffmpeg -i universe-loop-720p.mp4 -i score-suno.wav -map 0:v -map 1:a -c:v copy
# -c:a aac -b:a 192k -shortest
import sys, os, subprocess, tempfile
import numpy as np
import soundfile as sf

SONG = os.path.expanduser(os.environ.get('SONG', '~/codeprojects/music-library/as-above-so-below-loop/full-mix.wav'))
LOOPED = bool(os.environ.get('LOOPED'))
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'film', 'loop', 'score-suno.wav')
frames = int(sys.argv[1]) if len(sys.argv) > 1 else 3235
fps = float(sys.argv[2]) if len(sys.argv) > 2 else 30
L = frames / fps
FOLD = 1.7

info = sf.info(SONG)
# (a round score stretched to the film exactly: what's past its end is its own head, folded over it to smooth the start)
ratio = (L + (0 if LOOPED else FOLD)) / info.duration
with tempfile.TemporaryDirectory() as d:
    src = SONG
    if LOOPED:
        # (a round score: a few seconds of its head after its end, so what's stretched past the end is its own start)
        a, sr0 = sf.read(SONG, always_2d=True)
        src = os.path.join(d, 'round.wav')
        sf.write(src, np.concatenate([a, a[:int(sr0 * 4)]]), sr0, subtype='FLOAT')
    tmp = os.path.join(d, 'stretched.wav')
    subprocess.run(['rubberband', '-q', '--fine', '-t', f'{ratio:.6f}', src, tmp], check=True)
    y, sr = sf.read(tmp, always_2d=True)
S = lambda t: int(round(t * sr))
N, X = S(L), S(FOLD)
# (exactly the film plus the fold: Rubber Band's length is within a few samples)
y = y[:N + X] if len(y) >= N + X else np.concatenate([y, np.zeros((N + X - len(y), y.shape[1]))])
u = np.linspace(0, 1, X, endpoint=False)[:, None]
out = y[:N].copy()
out[:X] = out[:X] * np.sin(u * np.pi / 2) + y[N:N + X] * np.cos(u * np.pi / 2)
# (-1 dBFS peak, then to about -14 LUFS: the song's own level, measured)
out *= 10 ** (-1 / 20) / np.abs(out).max() * 10 ** (-1 / 20)
sf.write(OUT, out.astype(np.float32), sr, subtype='PCM_24')
print(f'wrote {OUT}: {len(out) / sr:.3f} s, stretched x{ratio:.5f}, {FOLD} s folded over the head')
