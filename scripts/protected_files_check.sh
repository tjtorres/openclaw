#!/usr/bin/env bash
# Protected files pre-commit hook — warns when sensitive files are modified.
# Install: ln -sf $(pwd)/scripts/protected_files_check.sh .git/hooks/pre-commit
#
# Protected files require explicit confirmation before committing changes.
set -euo pipefail

# ── Protected Files ──
# These files control agent identity, permissions, and security.
# Edits should be intentional, not accidental.

PROTECTED_FILES=(
  "SOUL.md"
  "USER.md"
  "AGENTS.md"
  "IDENTITY.md"
  ".env"
  "agents/*/permissions.json"
  "agents/*/SOUL.md"
)

WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
cd "$WORKSPACE"

# Check if any protected files are staged for commit
MODIFIED=()
for pattern in "${PROTECTED_FILES[@]}"; do
  # Use git diff to find staged changes matching the pattern
  while IFS= read -r file; do
    [ -n "$file" ] && MODIFIED+=("$file")
  done < <(git diff --cached --name-only -- "$pattern" 2>/dev/null)
done

if [ ${#MODIFIED[@]} -eq 0 ]; then
  exit 0
fi

echo "⚠️  PROTECTED FILE WARNING"
echo "   The following sensitive files have been modified:"
echo
for f in "${MODIFIED[@]}"; do
  echo "   🔒 $f"
done
echo
echo "   These files control agent identity, permissions, and security."
echo "   Changes should be intentional."
echo

# In non-interactive mode (e.g., auto-commit), block the commit
if [ ! -t 0 ]; then
  echo "   ❌ Blocked: non-interactive commit of protected files."
  echo "   Run 'git commit' interactively to confirm, or use --no-verify to override."
  exit 1
fi

# Interactive mode: ask for confirmation
echo -n "   Continue with commit? (y/N) "
read -r -n 1 reply
echo
if [[ ! $reply =~ ^[Yy]$ ]]; then
  echo "   ❌ Commit cancelled"
  exit 1
fi

echo "   ✅ Confirmed — proceeding with commit"
