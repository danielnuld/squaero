#!/usr/bin/env bash
# Publish site/ to the gh-pages branch root (GitHub Pages, no Actions needed).
# Run from anywhere in the repo. Uses a separate worktree so it never disturbs
# your current checkout. See docs/SITE.md.
set -eu
cd "$(dirname "$0")/.."
SRC="$(pwd)/site"
BRANCH="gh-pages"
GITDIR="$(git rev-parse --absolute-git-dir)"
WT="$GITDIR/publish-site"

git worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"

# The worktree continues the published history when there is one, so a normal
# push is enough; the very first publish starts the branch from the current commit.
if git fetch -q origin "$BRANCH" 2>/dev/null; then
  git worktree add -q -B "$BRANCH" "$WT" "origin/$BRANCH"
else
  git worktree add -q -B "$BRANCH" "$WT" HEAD
fi

# Replace its contents with the site payload (keep .git), excluding this script.
find "$WT" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$SRC"/. "$WT"/
rm -f "$WT/publish.sh"
touch "$WT/.nojekyll"

# Point git at the worktree explicitly: on a drive without file ownership
# (exFAT) or in a temp folder, git refuses the new worktree as "dubious
# ownership" even when the repository itself is listed in safe.directory.
( cd "$WT"
  export GIT_DIR="$GITDIR/worktrees/publish-site" GIT_WORK_TREE="$WT"
  git add -A
  if git diff --cached --quiet; then
    echo "nothing to publish (site unchanged)"
  else
    git commit -q -m "site: publish $(date -u +%Y-%m-%dT%H:%MZ)"
    git push -q -u origin "$BRANCH"
    echo "Published site/ to origin/$BRANCH."
  fi )

git worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"
