#!/usr/bin/env bash
# Запуск kana.app.
#   ./run.sh              — с сервером (статика + /api + прокси Gemini)
#   ./run.sh --static     — только static-сервер (без backend, прогресс в localStorage)
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--static" ]]; then
  exec python3 -m http.server 10001 --bind 0.0.0.0 --directory app
fi

PY=python3
if [[ -x .venv/bin/python ]]; then PY=.venv/bin/python; fi

if ! "$PY" -c "import fastapi" >/dev/null 2>&1; then
  echo "→ устанавливаю зависимости…"
  "$PY" -m pip install --quiet --upgrade pip >/dev/null
  "$PY" -m pip install --quiet -r server/requirements.txt
fi

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-10001}
echo "→ kana.app на http://${HOST}:${PORT}"
exec "$PY" -m uvicorn server.app:app --host "$HOST" --port "$PORT"
