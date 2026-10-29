#!/usr/bin/env bash
set -euo pipefail
git init -q
mkdir -p inventory tests
cat > inventory/model.py <<'PY'
from dataclasses import dataclass


@dataclass(frozen=True)
class Item:
    sku: str
    title: str
    quantity: int
PY
touch inventory/__init__.py tests/__init__.py
git add . && git -c user.name=eval -c user.email=eval@example.com commit -qm init
