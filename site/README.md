Static site for sona.dorara.app (Cloudflare Pages project `sona`).

Voice demos: list the recordings and lines in `demo/voices.json`, then run `demo/make-demo.sh demo/voices.json`.
It writes `assets/demo/` (mp3s) and `assets/demo.js`; the page shows the demo section only when `assets/demo.js` exists.

Deploy: `CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_AC_ID npx wrangler pages deploy site --project-name sona --branch main --commit-dirty=true`.
Bump `?v=N` in index.html when CSS/JS change.
