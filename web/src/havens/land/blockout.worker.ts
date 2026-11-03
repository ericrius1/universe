// One level of the blockout land made off the main thread (blockout.ts blockoutLevel): its heights and its material,
// handed back without a copy.
import { blockoutLevel } from './blockout';
import type { HeightLevelSpec } from './levels';

self.onmessage = (e: MessageEvent<HeightLevelSpec>) => {
  const { heights, info } = blockoutLevel(e.data);
  (self as unknown as Worker).postMessage({ heights, info }, [heights.buffer, info.buffer]);
};
