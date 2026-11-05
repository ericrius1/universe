# The loop film's score: Suno's "As Above, So Below (loop)" (05080fe6-7624-4d35-b7c4-034fd13b6814), made for the film
# at its length — 1970s cosmic progressive rock, a lone 12-string opening, building to its brightest at the keepers and
# easing back to the opening figure, which is where it ends (its WAV in
# ~/codeprojects/music-library/as-above-so-below-loop/full-mix.wav, 107.56 s, 64.6 bpm). Stretched a hair (Rubber Band,
# pitch kept) to the film's length plus FOLD seconds, and those seconds past the end folded over the head, so the music
# runs on through the loop's seam; FOLD picked so the end's beats land on the head's (within 2% of a beat).
#   python3 tools/loop-score.py [frames]      (default 3235, at 30 fps) -> ../film/loop/score-suno.wav, at about -14 LUFS
# then mux it into the encoded films: ffmpeg -i universe-loop-1080p.mp4 -i score-suno.wav -map 0:v -map 1:a -c:v copy
# -c:a aac -b:a 256k -shortest (and the same for 720p).
import sys, os, subprocess, tempfile
import numpy as np
import soundfile as sf

SONG = os.path.expanduser('~/codeprojects/music-library/as-above-so-below-loop/full-mix.wav')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'film', 'loop', 'score-suno.wav')
frames = int(sys.argv[1]) if len(sys.argv) > 1 else 3235
L = frames / 30
FOLD = 1.7

info = sf.info(SONG)
ratio = (L + FOLD) / info.duration
with tempfile.TemporaryDirectory() as d:
    tmp = os.path.join(d, 'stretched.wav')
    subprocess.run(['rubberband', '-q', '--fine', '-t', f'{ratio:.6f}', SONG, tmp], check=True)
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
