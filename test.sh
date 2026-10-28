#!/usr/bin/env bash
# Все тесты: парсер path, оценка письма, smoke-прогон экранов.
set -uo pipefail
cd "$(dirname "$0")"

PY=python3
[[ -x .venv/bin/python ]] && PY=.venv/bin/python

echo "→ проверяю, что данные каны на месте"
if [[ ! -s app/data/kana.json ]]; then
  echo "  app/data/kana.json не найден — пересобираю"
  "$PY" tools/generate_data.py --source tools/kanjivg-src --out app/data/kana.json || exit 1
fi

if [[ ! -d .test/node_modules ]]; then
  echo "→ устанавливаю тестовые зависимости (jsdom, canvas)"
  ( cd .test && npm install --no-audit --no-fund >/dev/null ) || {
    echo "  не удалось поставить тесты — пропускаю (npm нужен только для ./test.sh)"
    exit 0
  }
fi

FAIL=0
for t in path draw smoke; do
  echo
  echo "→ ${t}.mjs"
  ( cd .test && node ${t}.mjs ) || FAIL=1
done

echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ все тесты прошли"
else
  echo "❌ есть ошибки"
fi
exit $FAIL
