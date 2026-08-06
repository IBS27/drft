#!/bin/sh
set -eu

project_root="${T3CODE_PROJECT_ROOT:?T3CODE_PROJECT_ROOT is required}"
worktree_root="${T3CODE_WORKTREE_PATH:-$(pwd -P)}"

copy_local_file() {
  relative_path="$1"
  source_path="$project_root/$relative_path"
  destination_path="$worktree_root/$relative_path"

  if [ ! -f "$source_path" ]; then
    printf 'Skipping missing file: %s\n' "$relative_path"
    return
  fi

  if [ -e "$destination_path" ]; then
    printf 'Keeping existing file: %s\n' "$relative_path"
    return
  fi

  mkdir -p "$(dirname "$destination_path")"
  cp -p "$source_path" "$destination_path"
  printf 'Copied: %s\n' "$relative_path"
}

copy_local_file "apps/web/.env.local"
copy_local_file "packages/backend/.env.local"
