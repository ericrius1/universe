// Encode the loop (src/loop.ts, rendered by tools/film.mjs loop) so it plays round seamlessly: its frames as they are
// (the last is the one before the first), and the score, rendered a few seconds longer than the picture, folded back
// on itself — its tail laid over its head with equal-power fades, so where the picture meets its start the music
// already flows on. 1080p (the grain kept from ballooning it) and a lighter 720p for phones.
//   node tools/loop.mjs [name]      (default: loop; reads ../film/<name>/frames and audio.wav)
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const name = process.argv[2] ?? 'loop';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const dir = resolve('..', 'film', name);
const frames = readdirSync(resolve(dir, 'frames')).filter((f) => f.endsWith('.jpg')).length;
const T = frames / 30, X = 3;
const audio = resolve(dir, 'audio.wav'), looped = resolve(dir, 'audio-loop.wav');
// (the head faded in, the tail past T faded out and laid over it)
execFileSync(FFMPEG, ['-y', '-i', audio, '-filter_complex',
  `[0]atrim=0:${T},asetpts=PTS-STARTPTS,afade=t=in:d=${X}:curve=qsin[a];[0]atrim=${T}:${T + X},asetpts=PTS-STARTPTS,afade=t=out:d=${X}:curve=qsin[b];[a][b]amix=inputs=2:duration=first:normalize=0[o]`,
  '-map', '[o]', looped], { stdio: 'inherit' });
const enc = (out, scale, maxrate, crf) => execFileSync(FFMPEG, ['-y', '-framerate', '30', '-i', resolve(dir, 'frames', 'f%05d.jpg'), '-i', looped,
  ...(scale ? ['-vf', `scale=${scale}:flags=lanczos`] : []), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-maxrate', maxrate, '-bufsize', maxrate.replace('M', '') * 2 + 'M',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', resolve(dir, out)], { stdio: 'inherit' });
enc(`universe-${name}-1080p.mp4`, null, '13M', 18);
enc(`universe-${name}-720p.mp4`, '1280:720', '3.4M', 20);
console.log(`wrote ${dir}/universe-${name}-1080p.mp4 and -720p.mp4: ${frames} frames, ${T.toFixed(2)} s, the score folded over ${X} s`);
