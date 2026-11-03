// Where the data lives: everything under assets/ beside the app, under the site's base path (/havens/ on ericlevin.dev).
// In development a file that isn't on this disk is taken from boulder's R2 (vite.config.ts r2Fallback); the deployed
// build carries its own copies of everything it loads.
export let ASSET_ROOT = `${import.meta.env.BASE_URL}assets`;

/** where the assets are for an app the canyon is drawn in (embed.ts): its own copy (before anything loads) */
export function setAssetRoot(url: string) { ASSET_ROOT = url.replace(/\/$/, ''); }

/** the URL of a file under assets/ */
export const asset = (rel: string) => `${ASSET_ROOT}/${rel}`;

/** a file under assets/ */
export const fetchAsset = (rel: string) => fetch(asset(rel));

/** a file's bytes as a blob (an image to decode), or an error naming it */
export async function loadBlob(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.blob();
}
