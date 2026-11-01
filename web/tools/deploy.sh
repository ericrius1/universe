#!/usr/bin/env bash
# Put Universe on the web: its own Vercel project (universe), built for /universe/ (web/vercel.json: the app, the
# molecules, the ground round the spot, the art and the footage page under /universe/, the root redirected there), so
# that ericlevin.dev/universe can later be one rewrite in the homepage's vercel.json to it, as /havens and /aether are.
# The films aren't part of it: they're on the footage storage (~/codeprojects/footage), listed by public/footage/footage.json.
#   bash web/tools/deploy.sh            a preview deployment
#   bash web/tools/deploy.sh --prod     production
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
git -C .. diff --quiet HEAD -- web || echo "note: Universe has uncommitted changes in web/, and this deployment has them too"
# (the CLI as it is now: an old global one is refused by the API)
[[ -f .vercel/project.json ]] || npx -y vercel@latest link --yes --project universe
npx -y vercel@latest deploy "$@"
