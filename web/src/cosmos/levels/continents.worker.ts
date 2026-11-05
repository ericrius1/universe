// The Earth's map painted off the page's thread (earth.ts asks as the cosmos is made): the coastlines rasterised and
// their mips made (continents.ts, on an OffscreenCanvas), handed back moved; null where a worker can't paint (no 2D
// OffscreenCanvas), and the page paints it when the Earth first comes in sight.
import { mips, rasterise } from './continents';

self.onmessage = (e: MessageEvent<[number, number]>) => {
  const [w, h] = e.data;
  let chain: Uint8Array[] | null = null;
  try { chain = mips(rasterise(w, h), w, h); } catch { /* the page paints it */ }
  self.postMessage(chain, { transfer: chain?.map((m) => m.buffer as ArrayBuffer) ?? [] });
};
