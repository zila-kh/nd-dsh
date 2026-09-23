#!/usr/bin/env bash
set -eu

base="${1:-main}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "error: not inside a git worktree" >&2
  exit 2
}

branch="$(git branch --show-current)"
head="$(git rev-parse HEAD)"
status="$(git status --short --branch)"

base_ref=""
if git show-ref --verify --quiet "refs/remotes/origin/${base}"; then
  base_ref="origin/${base}"
elif git show-ref --verify --quiet "refs/heads/${base}"; then
  base_ref="${base}"
else
  echo "error: base branch '${base}' not found locally or at origin" >&2
  exit 3
fi

base_sha="$(git rev-parse "${base_ref}")"
counts="$(git rev-list --left-right --count "${base_ref}...HEAD")"
behind="$(printf '%s' "${counts}" | awk '{print $1}')"
ahead="$(printf '%s' "${counts}" | awk '{print $2}')"
remote_url="$(git remote get-url origin 2>/dev/null || true)"

cat <<OUT
repository: ${remote_url}
feature_branch: ${branch}
feature_head: ${head}
base_branch: ${base}
base_ref: ${base_ref}
base_head: ${base_sha}
ahead: ${ahead}
behind: ${behind}
status:
${status}
OUT
