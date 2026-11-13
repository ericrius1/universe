Copied from the Hepatocyte project's src (embed.ts and what it reaches) by tools/hepatocyte-sync.mjs: edit it there, then `npm run hepatocyte`.

Hepatocyte fd3cca0 The tools take the GPU lock from Universe's tools/gpulock.mjs (a queue, the holder's pid): the old lock let two jobs draw at once
