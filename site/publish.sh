#!/usr/bin/env bash
# Publish site/ to the gh-pages branch root (GitHub Pages, no Actions needed).
# Run from anywhere in the repo. Requires a clean-ish working tree (only touches
# a temporary worktree). See docs/SITE.md.
set -eu
cd "$(dirname "$0")/.."
SRC="site"
BRANCH="gh-pages"
TMP="$(mktemp -d)"

# Copy the site payload into a scratch dir (excluding this script).
cp -r "$SRC"/. "$TMP"/
rm -f "$TMP/publish.sh"

# Materialize (or reset) the gh-pages branch from the payload and push it.
git worktree add --force -B "$BRANCH" "$TMP/.wt" >/dev/null 2>&1 || git worktree add "$TMP/.wt" "$BRANCH"
find "$TMP/.wt" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$TMP"/. "$TMP/.wt"/
rm -rf "$TMP/.wt/.wt"
( cd "$TMP/.wt"
  git add -A
  git commit -m "site: publish $(date -u +%Y-%m-%dT%H:%MZ)" >/dev/null 2>&1 || { echo "nothing to publish"; exit 0; }
  git push -u origin "$BRANCH" --force-with-lease )
git worktree remove --force "$TMP/.wt" >/dev/null 2>&1 || true
rm -rf "$TMP"
echo "Published site/ to origin/$BRANCH. Set Pages source to gh-pages / root (one-time)."
