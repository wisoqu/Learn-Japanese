#!/usr/bin/env python3
"""
Build app/data/kana.json from KanjiVG SVGs.

KanjiVG is (C) Ulrich Apel, licensed CC-BY-SA 3.0.  http://kanjivg.tagaini.net/
The generated data keeps the original attribution in NOTICE.md.

KanjiVG encodes stroke order as the *document order* of the <path> elements
inside <g id="kvg:StrokePaths_...">; <g id="kvg:StrokeNumbers_..."> carries the
1..N labels that confirm it. We extract the paths verbatim so the browser can
animate them one at a time and reuse them for the drawing practice.

Usage:
    python3 tools/generate_data.py --source /path/to/kanjivg/kanji
"""

import argparse
import json
import os
import re

# ---------------------------------------------------------------- kana tables

HIRAGANA = [
    # gojuuon, basic rows
    ("あ", "a", ""), ("い", "i", ""), ("う", "u", ""), ("え", "e", ""), ("お", "o", ""),
    ("か", "ka", ""), ("き", "ki", ""), ("く", "ku", ""), ("け", "ke", ""), ("こ", "ko", ""),
    ("さ", "sa", ""), ("し", "shi", ""), ("す", "su", ""), ("せ", "se", ""), ("そ", "so", ""),
    ("た", "ta", ""), ("て", "te", ""), ("と", "to", ""),
    ("な", "na", ""), ("に", "ni", ""), ("ぬ", "nu", ""), ("ね", "ne", ""), ("の", "no", ""),
    ("は", "ha", ""), ("ひ", "hi", ""), ("ふ", "fu", ""), ("へ", "he", ""), ("ほ", "ho", ""),
    ("ま", "ma", ""), ("み", "mi", ""), ("む", "mu", ""), ("め", "me", ""), ("も", "mo", ""),
    ("や", "ya", ""), ("ゆ", "yu", ""), ("よ", "yo", ""),
    ("ら", "ra", ""), ("り", "ri", ""), ("る", "ru", ""), ("れ", "re", ""), ("ろ", "ro", ""),
    ("わ", "wa", ""), ("を", "wo", ""), ("ゔ", "vu", ""),
    # small kana
    ("ぁ", "a", "small"), ("ゕ", "ka", "small"), ("ゖ", "ke", "small"),
    ("ゃ", "ya", "small"), ("ゅ", "yu", "small"), ("ょ", "yo", "small"),
    ("ゎ", "wa", "small"), ("っ", "tsu", "small-tsu"),
    # dakuten
    ("が", "ga", "voiced"), ("ぎ", "gi", "voiced"), ("ぐ", "gu", "voiced"),
    ("げ", "ge", "voiced"), ("ご", "go", "voiced"),
    ("ざ", "za", "voiced"), ("じ", "ji", "voiced"), ("ず", "zu", "voiced"),
    ("ぜ", "ze", "voiced"), ("ぞ", "zo", "voiced"),
    ("だ", "da", "voiced"), ("ぢ", "ji", "voiced"), ("づ", "zu", "voiced"),
    ("で", "de", "voiced"), ("ど", "do", "voiced"),
    ("ば", "ba", "voiced"), ("び", "bi", "voiced"), ("ぶ", "bu", "voiced"),
    ("べ", "be", "voiced"), ("ぼ", "bo", "voiced"),
    # handakuten
    ("ぱ", "pa", "p"), ("ぴ", "pi", "p"), ("ぷ", "pu", "p"),
    ("ぺ", "pe", "p"), ("ぽ", "po", "p"),
    # extras
    ("ゐ", "i", "archaic"), ("ゑ", "e", "archaic"),
]

KATAKANA = [
    ("ア", "a", ""), ("イ", "i", ""), ("ウ", "u", ""), ("エ", "e", ""), ("オ", "o", ""),
    ("カ", "ka", ""), ("キ", "ki", ""), ("ク", "ku", ""), ("ケ", "ke", ""), ("コ", "ko", ""),
    ("サ", "sa", ""), ("シ", "shi", ""), ("ス", "su", ""), ("セ", "se", ""), ("ソ", "so", ""),
    ("タ", "ta", ""), ("チ", "chi", ""), ("ツ", "tsu", ""), ("テ", "te", ""), ("ト", "to", ""),
    ("ナ", "na", ""), ("ニ", "ni", ""), ("ヌ", "nu", ""), ("ネ", "ne", ""), ("ノ", "no", ""),
    ("ハ", "ha", ""), ("ヒ", "hi", ""), ("フ", "fu", ""), ("ヘ", "he", ""), ("ホ", "ho", ""),
    ("マ", "ma", ""), ("ミ", "mi", ""), ("ム", "mu", ""), ("メ", "me", ""), ("モ", "mo", ""),
    ("ヤ", "ya", ""), ("ユ", "yu", ""), ("ヨ", "yo", ""),
    ("ラ", "ra", ""), ("リ", "ri", ""), ("ル", "ru", ""), ("レ", "re", ""), ("ロ", "ro", ""),
    ("ワ", "wa", ""), ("ヰ", "i", "archaic"), ("ヱ", "e", "archaic"), ("ヲ", "wo", ""),
    # small kana
    ("ァ", "a", "small"), ("ィ", "i", "small"), ("ゥ", "u", "small"), ("ェ", "e", "small"),
    ("ォ", "o", "small"), ("ャ", "ya", "small"), ("ュ", "yu", "small"), ("ョ", "yo", "small"),
    ("ッ", "tsu", "small-tsu"), ("ヮ", "wa", "small"),
    ("ヵ", "ka", "small"), ("ヶ", "ke", "small"),
    # dakuten
    ("ガ", "ga", "voiced"), ("ギ", "gi", "voiced"), ("グ", "gu", "voiced"),
    ("ゲ", "ge", "voiced"), ("ゴ", "go", "voiced"),
    ("ザ", "za", "voiced"), ("ジ", "ji", "voiced"), ("ズ", "zu", "voiced"),
    ("ゼ", "ze", "voiced"), ("ゾ", "zo", "voiced"),
    ("ダ", "da", "voiced"), ("ヂ", "ji", "voiced"), ("ヅ", "zu", "voiced"),
    ("デ", "de", "voiced"), ("ド", "do", "voiced"),
    ("バ", "ba", "voiced"), ("ビ", "bi", "voiced"), ("ブ", "bu", "voiced"),
    ("ベ", "be", "voiced"), ("ボ", "bo", "voiced"),
    ("ヴ", "vu", "voiced"),
    # handakuten
    ("パ", "pa", "p"), ("ピ", "pi", "p"), ("プ", "pu", "p"),
    ("ペ", "pe", "p"), ("ポ", "po", "p"),
    # marks / v-sounds
    ("ー", "u", "mark"), ("・", "to", "mark"),
    ("ヽ", "repeat", "mark"), ("ヾ", "repeat", "mark"),
    ("ヷ", "va", "v"), ("ヸ", "vi", "v"), ("ヹ", "ve", "v"), ("ヺ", "vo", "v"),
]

HIRAGANA_ROWS = [
    ("hira-a", "あ行", ["あ", "い", "う", "え", "お"]),
    ("hira-k", "か行", ["か", "き", "く", "け", "こ"]),
    ("hira-s", "さ行", ["さ", "し", "す", "せ", "そ"]),
    ("hira-t", "た行", ["た", "て", "と"]),
    ("hira-n", "な行", ["な", "に", "ぬ", "ね", "の"]),
    ("hira-h", "は行", ["は", "ひ", "ふ", "へ", "ほ"]),
    ("hira-m", "ま行", ["ま", "み", "む", "め", "も"]),
    ("hira-y", "や行", ["や", "ゆ", "よ"]),
    ("hira-r", "ら行", ["ら", "り", "る", "れ", "ろ"]),
    ("hira-w", "わ行", ["わ", "を", "ゔ"]),
    ("hira-small", "小文字・ゃゅょ", ["ゃ", "ゅ", "ょ", "ゎ", "っ"]),
    ("hira-daku", "濁音 がざだば", ["が", "ぎ", "ぐ", "げ", "ご", "ざ", "じ", "ず", "ぜ", "ぞ",
                                      "だ", "ぢ", "づ", "で", "ど", "ば", "び", "ぶ", "べ", "ぼ"]),
    ("hira-handaku", "半濁音 ぱ", ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"]),
    ("hira-extra", "補助・記号", ["ぁ", "ゕ", "ゖ", "ゐ", "ゑ", "ゝ", "ゞ"]),
]

KATAKANA_ROWS = [
    ("kat-a", "ア行", ["ア", "イ", "ウ", "エ", "オ"]),
    ("kat-k", "カ行", ["カ", "キ", "ク", "ケ", "コ"]),
    ("kat-s", "サ行", ["サ", "シ", "ス", "セ", "ソ"]),
    ("kat-t", "タ行", ["タ", "チ", "ツ", "テ", "ト"]),
    ("kat-n", "ナ行", ["ナ", "ニ", "ヌ", "ネ", "ノ"]),
    ("kat-h", "ハ行", ["ハ", "ヒ", "フ", "ヘ", "ホ"]),
    ("kat-m", "マ行", ["マ", "ミ", "ム", "メ", "モ"]),
    ("kat-y", "ヤ行", ["ヤ", "ユ", "ヨ"]),
    ("kat-r", "ラ行", ["ラ", "リ", "ル", "レ", "ロ"]),
    ("kat-w", "ワ行", ["ワ", "ヰ", "ヱ", "ヲ", "ヮ"]),
    ("kat-small", "小文字・ャュョ", ["ァ", "ィ", "ゥ", "ェ", "ォ", "ャ", "ュ", "ョ", "ッ", "ヵ", "ヶ"]),
    ("kat-daku", "濁音 ガザダバ", ["ガ", "ギ", "グ", "ゲ", "ゴ", "ザ", "ジ", "ズ", "ゼ", "ゾ",
                                    "ダ", "ヂ", "ヅ", "デ", "ド", "バ", "ビ", "ブ", "ベ", "ボ", "ヴ"]),
    ("kat-handaku", "半濁音 パ", ["パ", "ピ", "プ", "ペ", "ポ"]),
    ("kat-v", "ヴ系 ヷヸヹヺ", ["ヷ", "ヸ", "ヹ", "ヺ"]),
    ("kat-mark", "記号・長音", ["ー", "・", "ヽ", "ヾ"]),
]

ROW_GROUPS = [
    ("basic", "基本 (五十音)"),
    ("small", "小文字・拗音"),
    ("voiced", "濁音・半濁音"),
    ("mark", "補助・記号"),
]

SET_NAMES = {"hiragana": "Хирагана", "katakana": "Катакана"}


def row_group(row_id):
    if row_id.endswith("small"):
        return "small"
    if row_id.endswith(("daku", "handaku")):
        return "voiced"
    if row_id.endswith(("mark", "extra")):
        return "mark"
    return "basic"


# --------------------------------------------------------------------- parser

PATH_RE = re.compile(r'<path\b([^>]*?)/?>', re.S)
ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
SVG_RE = re.compile(r'<svg\b[^>]*>', re.S)


def parse_svg(text):
    """Return (viewBox, [ {d, type} ]) with strokes in document (=drawing) order."""
    viewBox = "0 0 109 109"
    svg_tag = SVG_RE.search(text)
    if svg_tag:
        dims = dict(ATTR_RE.findall(svg_tag.group(0)))
        if dims.get("viewBox"):
            viewBox = " ".join(dims["viewBox"].split())
    strokes = []
    for raw in PATH_RE.findall(text):
        attrs = dict(ATTR_RE.findall(raw))
        d = attrs.get("d")
        if d and d.strip():
            strokes.append({"d": " ".join(d.split()), "type": attrs.get("kvg:type") or ""})
    return viewBox, strokes


def dedupe(table):
    """First occurrence wins (some chars are intentionally listed twice)."""
    seen, out = set(), []
    for item in table:
        if item[0] in seen:
            continue
        seen.add(item[0])
        out.append(item)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="/home/user/kanjivg-tmp/kanji",
                    help="directory with KanjiVG .svg files")
    ap.add_argument("--out", default="app/data/kana.json")
    args = ap.parse_args()

    missing, sets = [], []
    for name in ("hiragana", "katakana"):
        table = dedupe({"hiragana": HIRAGANA, "katakana": KATAKANA}[name])
        chars = {}
        for ch, romaji, note in table:
            fn = os.path.join(args.source, "%05x.svg" % ord(ch))
            if not os.path.exists(fn):
                missing.append(ch)
                chars[ch] = {"char": ch, "romaji": romaji, "note": note,
                             "strokes": [], "viewBox": "0 0 109 109", "missing": True}
                continue
            with open(fn, encoding="utf-8") as fh:
                vb, strokes = parse_svg(fh.read())
            chars[ch] = {"char": ch, "romaji": romaji, "note": note,
                         "strokes": strokes, "viewBox": vb}

        rows = []
        for row_id, label, items in {"hiragana": HIRAGANA_ROWS, "katakana": KATAKANA_ROWS}[name]:
            rows.append({
                "id": row_id,
                "label": label,
                "set": name,
                "group": row_group(row_id),
                "chars": [chars[c] for c in items if c in chars],
            })
        sets.append({
            "id": name,
            "name": SET_NAMES[name],
            "order": 0 if name == "hiragana" else 1,
            "rows": rows,
            "chars": [chars[c] for c, _, _ in table],
        })

    doc = {
        "version": 1,
        "generator": "tools/generate_data.py",
        "license": "KanjiVG data is CC-BY-SA 3.0 (Ulrich Apel). See NOTICE.md.",
        "rowGroups": [{"id": g, "label": l} for g, l in ROW_GROUPS],
        "sets": sets,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))

    n = sum(len(s["chars"]) for s in sets)
    print("wrote %s — %d chars, %d rows" % (args.out, n, sum(len(s["rows"]) for s in sets)))
    if missing:
        print("missing SVGs (skipped):", " ".join(missing))


if __name__ == "__main__":
    main()
