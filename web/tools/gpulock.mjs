// One GPU job at a time on a laptop shared by several people's tools (bench.mjs, shots.mjs and anything else that
// draws): two pages timing at once time each other. A lock (a directory under the system's temporary folder, made
// atomically) with the holder's process id in it, and a queue of tickets beside it so whoever asked first goes first
// (without it a tool that lets go and asks again straight away can keep everyone else out for an hour). A holder that
// has died is let go at once; one that hangs, after 25 minutes: so give every wait in a tool a timeout of its own, and
// hold the lock for one run, not a session.
//
//   import { lock, unlock } from './gpulock.mjs';
//   await lock('mine'); try { … } finally { unlock(); }
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// (GPU_LOCK_NAME: another lock's name, for trying this out)
const NAME = process.env.GPU_LOCK_NAME ?? 'universe-gpu';
const LOCK = join(tmpdir(), `${NAME}.lock`), QUEUE = join(tmpdir(), `${NAME}.queue`);
const STALE = 25 * 60e3, HOLD = 23 * 60e3;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let ticket = null, held = false;

/** whether this process's ticket is the oldest of the living */
function first() {
  for (const t of readdirSync(QUEUE).sort()) {
    if (!alive(Number(t.split('-')[1]))) { try { rmSync(join(QUEUE, t)); } catch { /* gone */ } continue; }
    return join(QUEUE, t) === ticket;
  }
  return true;
}

/** wait for the GPU, in turn */
export async function lock(who = 'gpu') {
  mkdirSync(QUEUE, { recursive: true });
  ticket = join(QUEUE, `${String(Date.now()).padStart(15, '0')}-${process.pid}`);
  writeFileSync(ticket, '');
  try {
    for (let waited = 0; ; waited += 2) {
      if (first()) {
        try {
          mkdirSync(LOCK);
          writeFileSync(join(LOCK, 'pid'), String(process.pid));
          held = true;
          // (a run that outstays any run's length has hung: it lets go and stops, rather than be called stale)
          setTimeout(() => { console.error(`${who}: held the GPU for ${HOLD / 60e3} minutes: letting go`); unlock(); process.exit(2); }, HOLD).unref();
          return;
        } catch { /* held */ }
        // (a holder that died, or one that has hung longer than any run takes; an older tool leaves no pid: its age alone)
        try {
          let pid = 0;
          try { pid = Number(readFileSync(join(LOCK, 'pid'), 'utf8')); } catch { /* none */ }
          if ((pid && !alive(pid)) || Date.now() - statSync(LOCK).mtimeMs > STALE) { rmSync(LOCK, { recursive: true, force: true }); continue; }
        } catch { continue; }
      }
      if (waited % 30 === 0) console.error(`${who}: waiting for the GPU…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally { try { rmSync(ticket); } catch { /* gone */ } ticket = null; }
}

/** let it go (only if it's still this process's: a run that overstayed was let go by someone else, who has it now) */
export function unlock() {
  if (ticket) { try { rmSync(ticket); } catch { /* gone */ } ticket = null; }
  if (!held) return;
  held = false;
  try { if (Number(readFileSync(join(LOCK, 'pid'), 'utf8')) === process.pid) rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ }
}

process.on('SIGINT', () => { unlock(); process.exit(130); });
process.on('SIGTERM', () => { unlock(); process.exit(143); });
