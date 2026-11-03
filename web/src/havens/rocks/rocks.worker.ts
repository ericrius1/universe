// Builds the rock catalogue off the main thread (rocks.ts catalogInWorker): every prototype's meshes, handed back with
// their arrays transferred, not copied.
import { buildCatalog } from './catalog';

self.onmessage = () => {
  const cat = buildCatalog();
  const transfer = cat.protos.flatMap((p) => p.lods.flatMap((m) => [m.pos.buffer, m.nrm.buffer, m.bed.buffer, m.ao.buffer, m.flags.buffer, m.idx.buffer]));
  self.postMessage(cat, { transfer });
};
