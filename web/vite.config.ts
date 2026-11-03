import { defineConfig } from 'vite';
import { weft, filmSink } from '@ericrius1/weft/vite';
import { resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Plugin } from 'vite';

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
// the dev server's and the local preview's: a device's reports (?report: src/ui/report.ts), one JSON line each, into
// logs/report.jsonl
function reportSink(): Plugin {
  const use = (s: { middlewares: { use: (f: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void } }) => {
      s.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('/__report') || req.method !== 'POST') return next();
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(resolve(__dirname, 'logs'), { recursive: true });
          appendFileSync(resolve(__dirname, 'logs/report.jsonl'), Buffer.concat(chunks).toString().replace(/\n/g, ' ') + '\n');
          res.end('ok');
        });
      });
  };
  return { name: 'universe-report', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [weft(), filmSink({ dir: resolve(__dirname, '../film') }), reportSink()],
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
  server: { host: '127.0.0.1', port: 5750, strictPort: true, allowedHosts: ['portal-windows.tail4a295a.ts.net', '.ngrok-free.app', '.ngrok.app'], fs: { allow: [__dirname, ...(local ? [WEFT] : []), ...(process.env.HAVENS_LOCAL ? [HAVENS] : [])] } },
  preview: { allowedHosts: ['portal-windows.tail4a295a.ts.net', '.ngrok-free.app', '.ngrok.app'] },
});
