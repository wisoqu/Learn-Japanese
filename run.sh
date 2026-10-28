#!/usr/bin/env bash
# Запуск kana.app.
#   ./run.sh              — с сервером (статика + /api + прокси Gemini)
#   ./run.sh --static     — только static-сервер (без backend, прогресс в localStorage)
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--static" ]]; then
  exec python3 -m http.server 10001 --bind 0.0.0.0 --directory app
fi

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-10001}

# --- python окружение -----------------------------------------------------
# В приоритете .venv, который создаём, если его нет — чтобы работало с
# чистого clone без ручных шагов. В системах с PEP 668 (Debian/Ubuntu)
# системный pip откажется ставить пакеты, поэтому везде используем venv.
PY=python3
if [[ ! -x .venv/bin/python ]]; then
  echo "→ создаю окружение .venv"
  if ! python3 -m venv .venv 2>/dev/null; then
    echo "  venv не удалось создать. Проверьте, что установлены python3-venv:" >&2
    echo "    sudo apt install python3-venv" >&2
    exit 1
  fi
fi
PY=.venv/bin/python

if ! "$PY" -c "import fastapi, uvicorn, httpx" >/dev/null 2>&1; then
  echo "→ устанавливаю зависимости…"
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r server/requirements.txt
fi

echo "→ kana.app на http://${HOST}:${PORT}"
exec "$PY" -m uvicorn server.app:app --host "$HOST" --port "$PORT"
