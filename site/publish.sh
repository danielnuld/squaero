#!/usr/bin/env bash
# Publish site/ to the gh-pages branch root (GitHub Pages, no Actions needed).
# Run from anywhere in the repo. Uses a detached worktree so it never disturbs
# your current checkout. See docs/SITE.md.
set -eu
cd "$(dirname "$0")/.."
SRC="$(pwd)/site"
BRANCH="gh-pages"
WT="$(mktemp -d)"

# A worktree on the (possibly new) gh-pages branch, based on the current commit.
git worktree add -B "$BRANCH" "$WT" HEAD >/dev/null 2>&1 || git worktree add "$WT" "$BRANCH"

# Replace its contents with the site payload (keep .git), excluding this script.
find "$WT" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$SRC"/. "$WT"/
rm -f "$WT/publish.sh"
touch "$WT/.nojekyll"

( cd "$WT"
  git add -A
  if git diff --cached --quiet; then
    echo "nothing to publish (site unchanged)"
  else
    git commit -q -m "site: publish $(date -u +%Y-%m-%dT%H:%MZ)"
    git push -u origin "$BRANCH" --force-with-lease
    echo "Published site/ to origin/$BRANCH."
  fi )

git worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"
