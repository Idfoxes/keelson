#!/usr/bin/env bash
set -euo pipefail
git init -q
mkdir -p .agent ui/i18n
printf '# Project\n\nAdmin panel for managing customer accounts.\n' > .agent/context.md
cat > .agent/conventions.json <<'JSON'
{"terms": {"customer": ["client"]}, "terms_paths": ["ui/**"], "ui": {"paths": ["ui/i18n/*.json"], "no_raw": true}}
JSON
cat > ui/i18n/en.json <<'JSON'
{
  "customers.title": "Customers",
  "customers.empty": "No customers yet"
}
JSON
git add . && git -c user.name=eval -c user.email=eval@example.com commit -qm init
