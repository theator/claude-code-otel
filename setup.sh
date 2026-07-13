#!/usr/bin/env bash
# Merge the Claude Code OTel telemetry env block into your ~/.claude/settings.json
# (creating it if absent) without clobbering existing settings. Backs up first.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLE="$DIR/settings.claude.example.json"
TARGET="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

command -v python3 >/dev/null 2>&1 || { echo "python3 is required." >&2; exit 1; }
[ -f "$EXAMPLE" ] || { echo "Missing $EXAMPLE" >&2; exit 1; }

echo "Target Claude Code settings: $TARGET"
mkdir -p "$(dirname "$TARGET")"

if [ -f "$TARGET" ]; then
  cp "$TARGET" "$TARGET.bak.$(date +%s)"
  echo "Backed up existing settings to $TARGET.bak.*"
fi

python3 - "$EXAMPLE" "$TARGET" <<'PY'
import json, sys, os
example_path, target_path = sys.argv[1], sys.argv[2]
example = json.load(open(example_path))
env_block = example["env"]

target = {}
if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
    try:
        target = json.load(open(target_path))
    except json.JSONDecodeError:
        print(f"WARNING: {target_path} is not valid JSON; leaving it untouched.", file=sys.stderr)
        sys.exit(1)

target.setdefault("env", {})
added, kept = [], []
for k, v in env_block.items():
    if k in target["env"] and target["env"][k] != v:
        kept.append(k)          # respect a value the user already set
    else:
        target["env"][k] = v
        added.append(k)

json.dump(target, open(target_path, "w"), indent=2)
print(f"Merged {len(added)} telemetry vars into env.")
if kept:
    print("Left your existing values untouched for: " + ", ".join(kept))
PY

cat <<EOF

Done. Telemetry is configured.

Notes:
  - OTEL_LOG_USER_PROMPTS and OTEL_LOG_TOOL_DETAILS are ON so the dashboard can show
    your actual prompts and shell commands. All data stays on your machine (local stack).
    Set either to "0" in $TARGET if you'd rather not capture that content.
  - Restart any running Claude Code sessions so they pick up the new settings.

Next:
  make up            # start the stack
  open http://localhost:3300
EOF
