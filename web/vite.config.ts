import { defineConfig } from 'vite';
import { weft, filmSink } from '@ericrius1/weft/vite';
import { resolve } from 'node:path';

// weft comes from npm (@ericrius1/weft). WEFT_LOCAL=1 compiles it from its source checkout instead (../../weft, a
// sibling repo), so a change to the kit hot-reloads here like the app's own code while it's being worked on; publish
// it and bump the version here once it's done.
const WEFT = resolve(__dirname, '../../weft/packages/weft');
const local = !!process.env.WEFT_LOCAL;
// Seven Havens' gardens (src/gardens.ts) come from its project: a copy in src/havens (tools/havens-sync.mjs, npm run
// havens), or under HAVENS_LOCAL=1 the sibling checkout's own source (../../sevenhavens/src), hot-reloading.
const HAVENS = process.env.HAVENS_LOCAL ? resolve(__dirname, '../../sevenhavens/src') : resolve(__dirname, 'src/havens');

// (built for ericlevin.dev/cell/: BASE=/cell/ npm run build. Films (?film=<name>, src/film.ts) post their frames to
// the server, into ../film/<name>)
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [weft(), filmSink({ dir: resolve(__dirname, '../film') })],
  resolve: {
    alias: [
      { find: /^@havens\//, replacement: `${HAVENS}/` },
      ...(local ? [
        { find: /^@ericrius1\/weft$/, replacement: `${WEFT}/src/index.ts` },
        { find: /^@ericrius1\/weft\/runtime$/, replacement: `${WEFT}/src/shader.ts` },
      ] : []),
    ],
  },
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  server: { host: '127.0.0.1', port: 5750, strictPort: true, allowedHosts: ['portal-windows.tail4a295a.ts.net'], fs: { allow: [__dirname, ...(local ? [WEFT] : []), ...(process.env.HAVENS_LOCAL ? [HAVENS] : [])] } },
  preview: { allowedHosts: ['portal-windows.tail4a295a.ts.net'] },
});
