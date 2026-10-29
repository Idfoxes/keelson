#!/usr/bin/env bash
set -euo pipefail
git init -q
mkdir -p app/utils
cat > app/utils/text.py <<'PY'
import re
import unicodedata


def slugify(title: str) -> str:
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")
PY
cat > app/articles.py <<'PY'
from dataclasses import dataclass


@dataclass
class Article:
    title: str
    body: str
PY
touch app/__init__.py app/utils/__init__.py
git add . && git -c user.name=eval -c user.email=eval@example.com commit -qm init
