# The loop film's score from Suno's "As Above, So Below I" (aeace914-8e71-4067-8de6-1066987fd4f3, 61.5 bpm, 3:50; its WAV
# in ~/codeprojects/music-library/as-above-so-below/full-mix.wav), cut to the film's length on its bar lines: its intro
# and theme under the cell, the eye and the gardens; its fuller theme past the Earth; its climax from the galaxies through
# the keepers; its own descent to the end, quiet again by the last frame. Then 3 s of what follows the end folded over the
# head, so the loop runs on through its seam. The cuts were picked where both sides match best (chroma, timbre, level),
# the loop point on the beat of the song's head.
#   python3 tools/loop-score.py [frames]      (default 3235, at 30 fps) -> ../film/loop/score-suno.wav, at -14 LUFS
# then mux it into the encoded films: ffmpeg -i universe-loop-1080p.mp4 -i score-suno.wav -map 0:v -map 1:a -c:v copy
# -c:a aac -b:a 256k -shortest (and the same for 720p).
import sys, os
import numpy as np
import soundfile as sf

SONG = os.path.expanduser('~/codeprojects/music-library/as-above-so-below/full-mix.wav')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'film', 'loop', 'score-suno.wav')
frames = int(sys.argv[1]) if len(sys.argv) > 1 else 3235
L = frames / 30
# the song's times (s): the first cut out of it and into it, the second, and into the climax (the third runs to the end)
t1, s2, e2, s3 = 45.42, 84.59, 108.09, 171.15
X, XF = 3.0, 0.5  # the fold over the head, each cut's crossfade

y, sr = sf.read(SONG, always_2d=True)
S = lambda t: int(round(t * sr))
f2 = t1 + (e2 - s2)
E3 = s3 + (L - f2)


def eqp(n):
    u = np.linspace(0, 1, n, endpoint=False)[:, None]
    return np.cos(u * np.pi / 2), np.sin(u * np.pi / 2)


def splice(a, b):
    n = S(XF)
    fo, fi = eqp(n)
    return np.concatenate([a[:-n], a[-n:] * fo + b[:n] * fi, b[n:]])


h = S(XF) // 2
out = splice(splice(y[0:S(t1) + h], y[S(s2) - h:S(e2) + h]), y[S(s3) - h:S(E3 + X)])
N = S(L)
tail, out = out[N:N + S(X)], out[:N].copy()
fo, fi = eqp(S(X))
out[:S(X)] = out[:S(X)] * fi + tail * fo
# (-1 dBFS peak, then down to about -14 LUFS)
out *= 10 ** (-1 / 20) / np.abs(out).max() * 10 ** (-1.6 / 20)
sf.write(OUT, out.astype(np.float32), sr, subtype='PCM_24')
print(f'wrote {OUT}: {len(out) / sr:.3f} s, the song to {E3:.2f} s')
