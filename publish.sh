#!/bin/zsh
# 上線一個新版本：改版號、commit、tag、push，從乾淨的副本建 Mac（簽名＋公證）和 Windows 安裝檔，發 GitHub Release，部署官網。
#   ./publish.sh 0.1.1 notes.md
# notes.md 是 release 說明（英文一段、中文一段、系統需求）。只發已經 commit 的東西：工作目錄裡沒 commit 的改動不會進安裝檔。
# 下載鈕固定連 releases/latest/download/Sona.dmg 和 Sona-Setup.exe，所以檔名不要改。
set -e
cd "${0:A:h}"
VERSION=$1 NOTES=${2:A}
[ -n "$VERSION" ] && [ -f "$NOTES" ] || { echo "usage: ./publish.sh <version> <notes.md>"; exit 1 }
[ -z "$(git status --porcelain)" ] || { echo "工作目錄有沒 commit 的改動，先 commit 或收起來"; exit 1 }
git fetch -q && [ "$(git rev-parse HEAD)" = "$(git rev-parse @{u})" ] || { echo "main 跟 origin 不同步，先 pull／push"; exit 1 }

npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
git add package.json package-lock.json
git commit -q --allow-empty -m "Sona $VERSION

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag v$VERSION
git push -q origin main v$VERSION

W=$(mktemp -d)/sona
git worktree add -q $W v$VERSION
trap "git worktree remove --force $W" EXIT
(cd $W && npm ci && npm --prefix frontend ci && npm run dist:mac:notarize && npm run dist:win)
xcrun stapler validate $W/dist/Sona.dmg
gh release create v$VERSION $W/dist/Sona.dmg $W/dist/Sona-Setup.exe --title "Sona $VERSION" --notes-file $NOTES
# 官網（sona.dorara.app）：下載鈕連 latest，所以 release 建好之後才部署
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_AC_ID npx wrangler pages deploy $W/site --project-name sona --branch main --commit-dirty=true
