#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${ROOT}/plugins/keelson"
KEELSON_HOME="${KEELSON_HOME:-${HOME}/.keelson}"
CODEX_DIR="${CODEX_HOME:-${HOME}/.codex}"
SKILLS_DIR="${KEELSON_SKILLS_DIR:-${HOME}/.agents/skills}"
RUNTIME="${KEELSON_HOME}/plugin"
MARKER=".keelson-managed"

usage() {
  echo "Usage: install-codex.sh [--uninstall]"
  echo "Copies the Keelson scripts to ${RUNTIME}, the skills to ${SKILLS_DIR}, and wires the hooks into ${CODEX_DIR}/hooks.json."
  echo "Override with KEELSON_HOME, CODEX_HOME and KEELSON_SKILLS_DIR."
}

install_all() {
  command -v node >/dev/null 2>&1 || { echo "node is required (18 or newer)" >&2; exit 1; }
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "Node 18 or newer is required" >&2; exit 1; }
  [[ -d "${SRC}/skills" ]] || { echo "Run this script from a checkout of the keelson repository" >&2; exit 1; }

  rm -rf "${RUNTIME}"
  mkdir -p "${RUNTIME}" "${SKILLS_DIR}"
  cp -R "${SRC}/scripts" "${SRC}/global" "${RUNTIME}/"

  local dir name
  for dir in "${SRC}"/skills/*/; do
    name="$(basename "${dir}")"
    if [[ -e "${SKILLS_DIR}/${name}" && ! -f "${SKILLS_DIR}/${name}/${MARKER}" ]]; then
      echo "Skipping skill ${name}: ${SKILLS_DIR}/${name} exists and was not installed by Keelson" >&2
      continue
    fi
    rm -rf "${SKILLS_DIR:?}/${name}"
    cp -R "${dir%/}" "${SKILLS_DIR}/${name}"
    : > "${SKILLS_DIR}/${name}/${MARKER}"
    node -e '
const fs = require("fs");
const path = require("path");
const [dir, root] = process.argv.slice(1);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk(dir).filter((f) => f.endsWith(".md"))) {
  const text = fs.readFileSync(file, "utf8");
  const next = text.split("${CLAUDE_PLUGIN_ROOT}").join(root);
  if (next !== text) fs.writeFileSync(file, next);
}
' "${SKILLS_DIR}/${name}" "${RUNTIME}"
  done

  node "${RUNTIME}/scripts/codex-hooks.mjs" "${CODEX_DIR}/hooks.json"
  echo "Scripts: ${RUNTIME}"
  echo "Skills: ${SKILLS_DIR}"
  echo "Hooks: ${CODEX_DIR}/hooks.json (Codex asks you to trust new hooks, approve them or they will not run)"
  echo "Data stays in ${HOME}/.agent. Update with git pull and run this script again."
}

uninstall_all() {
  local dir name
  if [[ -f "${RUNTIME}/scripts/codex-hooks.mjs" ]]; then
    node "${RUNTIME}/scripts/codex-hooks.mjs" --remove "${CODEX_DIR}/hooks.json"
  else
    echo "No installed scripts at ${RUNTIME}, hooks in ${CODEX_DIR}/hooks.json left as they are" >&2
  fi
  for dir in "${SRC}"/skills/*/; do
    name="$(basename "${dir}")"
    if [[ -f "${SKILLS_DIR}/${name}/${MARKER}" ]]; then
      rm -rf "${SKILLS_DIR:?}/${name}"
    elif [[ -e "${SKILLS_DIR}/${name}" ]]; then
      echo "Keeping skill ${name}: ${SKILLS_DIR}/${name} was not installed by Keelson" >&2
    fi
  done
  rm -rf "${RUNTIME}"
  rmdir "${KEELSON_HOME}" 2>/dev/null || true
  echo "Removed. Your data in ${HOME}/.agent is untouched."
}

case "${1:-}" in
  "") install_all ;;
  --uninstall) uninstall_all ;;
  -h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
