#!/usr/bin/env bash
# Put Cell on the web: ericlevin.dev/cell/ is served by the homepage itself (the PortfolioII repo, Vercel project
# portfolio-ii) from its public/cell/, so this builds Cell for /cell/ (the molecules and the art go in with it) into
# deploy/site/cell and, given a PortfolioII checkout, puts the build in place of its public/cell/. Committing that and
# pushing PortfolioII's main deploys it. The film isn't part of it: /cell/film/* redirects (PortfolioII's vercel.json)
# to the homepage's own copy, public/assets/worlds/cell/film.mp4.
#   bash web/tools/deploy.sh                  build into deploy/site/cell (copy it over public/cell/ by hand)
#   bash web/tools/deploy.sh ../PortfolioII   build, and stage it in that checkout (best a clean one, on origin/main)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/deploy/site/cell"
SITE="${1:-}"
if [[ -n "$SITE" ]] && ! grep -qs '"/cell/film/:file"' "$SITE/vercel.json"; then
  echo "deploy: $SITE isn't a PortfolioII checkout (no /cell/ routes in its vercel.json)" >&2
  exit 1
fi
cd "$ROOT/web"
npx tsc --noEmit
# (no Git Bash path translation on the PC: it would turn /cell/ into C:/Program Files/Git/cell/)
OUTDIR="$OUT"
command -v cygpath >/dev/null && OUTDIR="$(cygpath -m "$OUT")"
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" npx vite build --base /cell/ --outDir "$OUTDIR" --emptyOutDir | tail -3
du -sh "$OUT"
REV="$(git -C "$ROOT" log -1 --format='%h %s')"
git -C "$ROOT" diff --quiet HEAD -- web || echo "note: Cell has uncommitted changes in web/, and this build has them too"
if [[ -z "$SITE" ]]; then
  echo "built $OUT ($REV): put it in place of PortfolioII's public/cell/, then commit and push its main"
  exit 0
fi
rm -rf "$SITE/public/cell"
cp -R "$OUT" "$SITE/public/cell"
git -C "$SITE" add -A public/cell
if git -C "$SITE" diff --cached --quiet -- public/cell; then
  echo "public/cell/ in $SITE already has this build ($REV): nothing to deploy"
  exit 0
fi
git -C "$SITE" status --short -- public/cell
echo "staged in $SITE ($REV). To deploy:"
echo "  git -C \"$SITE\" commit -m \"Cell: <what changed> (ericrius1/Cell ${REV%% *})\" -- public/cell && git -C \"$SITE\" push origin HEAD:main"
