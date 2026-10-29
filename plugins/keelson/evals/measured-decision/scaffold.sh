#!/usr/bin/env bash
set -euo pipefail
git init -q
mkdir -p app docs/adr
cat > app/export.py <<'PY'
def rows_to_csv(rows: list[list[str]]) -> str:
    out = ""
    for row in rows:
        out += ",".join(row) + "\n"
    return out
PY
git add . && git -c user.name=eval -c user.email=eval@example.com commit -qm init
