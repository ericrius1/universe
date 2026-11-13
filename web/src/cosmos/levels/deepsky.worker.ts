// An image's bytes decoded off the page's thread (deepsky.ts decodeImage): fetched, decoded as it is (no colour-space
// conversion), shrunk to at most `max` a side if asked, and handed back moved — one channel ('gray': Planck's map), or
// the first image's colour with the second's first channel as alpha ('rgba': the face-on Milky Way and its dust, and
// if asked the stars drawn from it).
import { starsFromMap } from './galaxymap';

interface Ask { id: number; urls: string[]; mode: 'gray' | 'rgba'; max: number; stars?: number }

async function pixels(url: string, max: number): Promise<{ w: number; h: number; d: Uint8ClampedArray }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const blob = await r.blob();
  let bm = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (max && Math.max(bm.width, bm.height) > max) {
    const k = max / Math.max(bm.width, bm.height);
    const small = await createImageBitmap(bm, { resizeWidth: Math.round(bm.width * k), resizeHeight: Math.round(bm.height * k), resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    bm.close();
    bm = small;
  }
  const c = new OffscreenCanvas(bm.width, bm.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, bm.width, bm.height).data;
  const out = { w: bm.width, h: bm.height, d };
  bm.close();
  return out;
}

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, urls, mode, max } = e.data;
  try {
    const imgs = await Promise.all(urls.map((u) => pixels(u, max)));
    const { w, h, d } = imgs[0];
    const n = w * h;
    let data: Uint8Array;
    if (mode === 'gray') {
      data = new Uint8Array(n);
      for (let i = 0; i < n; i++) data[i] = d[i * 4];
    } else {
      data = new Uint8Array(n * 4);
      data.set(d);
      const a = imgs[1]?.d;
      for (let i = 0; i < n; i++) data[i * 4 + 3] = a ? a[i * 4] : 0;
    }
    // (and the Milky Way's stars drawn from its map, if asked: galaxymap.ts)
    const stars = e.data.stars ? starsFromMap(data, w, h, e.data.stars) : null;
    self.postMessage({ id, width: w, height: h, data, stars }, { transfer: stars ? [data.buffer, stars.buffer] : [data.buffer] });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
