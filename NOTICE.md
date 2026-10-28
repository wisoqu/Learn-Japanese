# Уведомление о содержимом (attribution)

## KanjiVG

Геометрическая разметка символов — следов кисти (stroke order), точек
направления и контуров — взята из проекта **KanjiVG**:

> KanjiVG: Kanji Vector Graphics
> Copyright (C) 2009/2010/2011 Ulrich Apel
> http://kanjivg.tagaini.net/
>
> Licenced under the Creative Commons
> Attribution-Share Alike 3.0 Unported licence
> http://creativecommons.org/licenses/by-sa/3.0/

Что именно используется:

- исходные SVG-файлы из `kanji/` KanjiVG для всех символов каны
  (диапазон U+3040–U+30FF и U+30A0–U+30FF), хранятся в `tools/kanjivg-src/`;
- `app/data/kana.json` — это собранные из них пути (path data), порядок strokes
  и viewBox. Это адаптированный материал, поэтому распространяем его под
  той же лицензией — CC-BY-SA 3.0.

### Условия лицензии CC-BY-SA 3.0

- **Attribution** — указание авторства: при распространии производных
  работ нужно указать автора KanjiVG и ссылку на http://kanjivg.tagaini.net/.
  Это заменяет то, что в KanjiVG называется "copyright header" в каждом SVG.
- **Share Alike** — если вы изменяете или создаёте производные на основе
  этого материала, вы можете распространять их только под той же или
  совместимой лицензией.

Вся операция генерации:

```bash
python3 tools/generate_data.py --source tools/kanjivg-src --out app/data/kana.json
```

Полный исходный код KanjiVG: https://github.com/kanjivg/kanjivg

## То, что здесь написано вручную

Всё остальное в этом репозитории — разметка, стили, логика повторения,
алгоритм оценки письма, серверная часть и тесты — написано специально для
kana.app и не защищено лицензией KanjiVG.
