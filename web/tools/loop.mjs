// Encode the loop (src/loop.ts, rendered by tools/film.mjs loop) so it plays round seamlessly: its frames as they are
// (the last is the one before the first), and the score, rendered a few seconds longer than the picture, folded back
// on itself — its tail laid over its head with equal-power fades, so where the picture meets its start the music
// already flows on. One 720p file at the film's rate (meta.json), about 3.5 Mbit/s (the house's film settings).
//   node tools/loop.mjs [name]      (default: loop; reads ../film/<name>/frames, meta.json and audio.wav)
// SCORE=<wav>: a score already made round at the film's length (tools/loop-score.py) in place of audio.wav's fold.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const name = process.argv[2] ?? 'loop';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const dir = resolve('..', 'film', name);
const frames = readdirSync(resolve(dir, 'frames')).filter((f) => f.endsWith('.jpg')).length;
const fps = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')).fps ?? 30;
const T = frames / fps, X = 3;
let looped = process.env.SCORE ? resolve(process.env.SCORE) : resolve(dir, 'audio-loop.wav');
if (!process.env.SCORE) {
  // (the head faded in, the tail past T faded out and laid over it)
  execFileSync(FFMPEG, ['-y', '-i', resolve(dir, 'audio.wav'), '-filter_complex',
    `[0]atrim=0:${T},asetpts=PTS-STARTPTS,afade=t=in:d=${X}:curve=qsin[a];[0]atrim=${T}:${T + X},asetpts=PTS-STARTPTS,afade=t=out:d=${X}:curve=qsin[b];[a][b]amix=inputs=2:duration=first:normalize=0[o]`,
    '-map', '[o]', looped], { stdio: 'inherit' });
}
const out = resolve(dir, `universe-${name}-720p.mp4`);
execFileSync(FFMPEG, ['-y', '-framerate', String(fps), '-i', resolve(dir, 'frames', 'f%05d.jpg'), '-i', looped,
  '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '4M', '-bufsize', '8M',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`wrote ${out}: ${frames} frames at ${fps} fps, ${T.toFixed(2)} s`);
