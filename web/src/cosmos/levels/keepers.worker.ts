// The keepers' still shapes made off the page's thread (beyond.ts asks once the zoom comes near): surface nets from
// their distance fields (keepers.ts keeperShapes), handed back moved.
import { keeperShapes } from './keepers';

self.onmessage = (e: MessageEvent<boolean>) => {
  const s = keeperShapes(e.data);
  self.postMessage(s, { transfer: [s.vb.buffer as ArrayBuffer, s.ib.buffer as ArrayBuffer] });
};
