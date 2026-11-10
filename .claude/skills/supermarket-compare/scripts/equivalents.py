#!/usr/bin/env python3
"""When the chains share no barcode: the same fresh commodity, priced per kilo or per pack weight.

Fruit, vegetables and eggs have chain-internal codes, so a barcode lookup can never compare them.
This module recognises what the product IS (a zucchini, 12 eggs size M) and finds the same thing
in another branch. Only fresh commodities and eggs are matched this way: a branded or private-label
product is either the same barcode or it is not compared at all.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

COMMODITIES = [  # most specific first: "עגבניות שרי" before "עגבניה", "תפוח אדמה" before "תפוח"
    ("תפוח אדמה", r"(?:תפוא|תפוח אדמה|תפוחי אדמה)\b"), ("בטטה", r"בטטה\b"),
    ("עגבניות שרי", r"(?:עגבני\S*\s+)?(?:שרי|לובלו)\b"), ("עגבניה", r"עגבני"),
    ("בצל ירוק", r"בצל ירוק"), ("בצל", r"בצל\b"), ("שום", r"שום\b"), ("גזר", r"גזר\b"), ("קישוא", r"קישוא"),
    ("מלפפון", r"מלפפון"), ("פלפל", r"פלפל\b"), ("חציל", r"חציל"), ("כרובית", r"כרובית"), ("כרוב", r"כרוב\b"),
    ("ברוקולי", r"ברוקולי"), ("חסה", r"חסה\b"), ("סלרי", r"סלרי"), ("סלק", r"סלק\b"), ("דלעת", r"דלעת"),
    ("תירס", r"תירס"), ("פטריות", r"(?:פטריות|שמפיניון)"), ("פטרוזיליה", r"פטרוזיליה"), ("כוסברה", r"כוסברה"),
    ("שמיר", r"שמיר\b"), ("נענע", r"נענע"), ("בננה", r"בננה\b|בננות\b"), ("תפוח", r"תפוח\b|תפוחים\b|תפוחי עץ"), ("אגס", r"אגס"),
    ("תפוז", r"תפוז"), ("קלמנטינה", r"(?:קלמנטינ|מנדרינ)"), ("לימון", r"לימון\b|לימונים\b"), ("אשכולית", r"אשכולית"),
    ("אבוקדו", r"אבוקדו"), ("מנגו", r"מנגו\b"), ("ענבים", r"ענב\b|ענבים\b"), ("תות", r"תות\b|תותים"), ("מלון", r"מלון\b"),
    ("אבטיח", r"אבטיח"), ("אפרסק", r"אפרסק"), ("נקטרינה", r"נקטרינ"), ("שזיף", r"שזיף|שזיפים"),
    ("אפרסמון", r"אפרסמון"), ("קיווי", r"קיווי"), ("אננס", r"אננס"), ("רימון", r"רימון"),
]
_FIRST = re.compile("^(?:" + "|".join(p for _, p in COMMODITIES) + ")")
_EACH = [(k, re.compile("^(?:" + p + ")")) for k, p in COMMODITIES]

# A name with one of these words is a processed product, whatever word it starts with
PROCESSED = re.compile(
    r"צ?יפס|שריר|אפוי|קפוא|בורקס|מאפה|רוטב|ממרח|סלט|מרק|קרם|שמן|נקטר|מיץ|ספרינג|פריגת|גאמפ|תפוזינה|שבבי|סיגרים|פסטל"
    r"|אטריות|נודלס|פתיתים|מעדן|יוגורט|משקה|מחית|טחון|מיובש|שימורים|כבוש|במלח|בחומץ|חמוץ|אינדירה|מבורך|חסלט|תערובת"
    r"|קלמרים|סוכריות|גלידה|ארטיק|חטיף|דגני|וופל|עוגה|עוגיות|ניוקי|קציצ|פירה|לביבות|קרוטונים|שוקו|ליקר|יין|בירה"
    r"|סבון|שמפו|מרכך|מגבונ|מתיר|אבקה|תבלין|ריבה|פרוס|מבושל|מטוגן|כדורי|קוביות"
    r"|מוקפא|גבישי|כתוש|גרוס|פלפל אנגלי|קלוי|מיונז|טחינה|טעם|בדץ|סירופ|מסוכר|בקופס|צנצנת|חצאים|חתוך|חתוכ|חתיכות|מרוסק"
    r"|קצוץ|קצוצ|קלוף|מקולפ|וואקום|רצועות|חמיצות|מקורמל|לחות|גלעין|גרעין(?!ים)|תירס גרעינ|מלח|קורנישון|חומוס|מטבוחה"
    r"|יבשה|ליטר|\bל\b|ללא סוכר|\bאש\b|\bהאש\b|מרוקאי|סלוניקי|פיקנטי|במינז|חלפיניו|שיפקה|אסלי|סרה\b|פרג\b|ביטון|ויליפוד|וילי פוד|ויליגר|יכין"
    r"|משחת|נעלי|נעליים|נפתח|קרמיקה|ציפורני")

# If the receipt has one of these, the other branch must too. If it doesn't, the other branch must not.
EXACT_WORDS = ("אורגני", "בייבי", "מיני", "גמדי", "קסביה", "ירושלמי", "כרעה", "עגול", "דק", "שטוף", "דרלן", "חופש", "אומגה", "בשל", "מוכן", "מיקרוגל")
COLORS = {"אדום": "אדום|אדומ", "ירוק": "ירוק", "צהוב": "צהוב", "כתום": "כתום", "לבן": "לבן|לבנ", "סגול": "סגול", "שחור": "שחור"}
VARIETIES = ("גאלה", "פינק", "סמיט", "גרני", "גולדן", "חרמון", "זהוב", "תמר", "מנומר", "אשכולות", "ליקופן", "האס", "אטינגר")


def clean(s: str) -> str:
    s = re.sub(r"[\"'`׳״.,*]", "", s or "")
    s = re.sub(r"(\d)([^\d\s.])", r"\1 \2", s)
    s = re.sub(r"([^\d\s.])(\d)", r"\1 \2", s)
    return re.sub(r"\s+", " ", s).strip()


def classify(name: str) -> str | None:
    """What this product is, or None if it is not a fresh commodity."""
    n = clean(name)
    if not _FIRST.match(n) or PROCESSED.search(n):
        return None
    for key, rx in _EACH:
        if rx.match(n):
            return key
    return None


def same_product(a: str, b: str) -> bool:
    """Containing the word is not enough: "בננה" is not "מיץ בננה"."""
    ka, kb = classify(a), classify(b)
    if ka or kb:
        return ka == kb
    ta, tb = ([w for w in clean(x).split() if not w.isdigit()] for x in (a, b))
    if not ta or not tb:
        return True
    return ta[0][:3] == tb[0][:3] or len(set(ta) & set(tb)) / len(set(ta) | set(tb)) > 0.5


def same_code_same_thing(a: str, b: str) -> bool:
    """The 72900000 range holds real barcodes (במבה) and chain-internal codes alike: two names on one number must agree."""
    ka, kb = classify(a), classify(b)
    if ka or kb:
        return ka == kb
    words = [{w[:4] for w in clean(x).split() if len(w) >= 3 and not w.isdigit()} for x in (a, b)]
    return bool(words[0] & words[1])


def egg_spec(name: str) -> tuple | None:
    """(count, size, is_special) for a tray of eggs."""
    n = clean(name)
    if "ביצ" not in n or re.search(r"אטרי|נודלס|פסט|סלט|פתית|שוקולד|עוגה", n):
        return None
    count = next((int(c) for c in re.findall(r"\b(\d{1,2})\b", n) if int(c) in (6, 10, 12, 18, 20, 30, 60)), None)
    m = re.search(r"\b(XL|L|M|S)\b", n, re.I)
    size = m.group(1).upper() if m else "XL" if "ענק" in n else "L" if "גדול" in n else "M" if re.search("בינוני|בנוני", n) else None
    if not count or not size:
        return None
    return count, size, bool(re.search("אורגני|חופש|אומגה", n))


def per_kg(item: dict) -> bool:
    return bool(item.get("weighted")) or item.get("unit") == "קילוגרם"


def grams(item: dict) -> float | None:
    """Weight of a pack, from the file's fields or from its name."""
    try:
        q = float(item.get("qty") or 0)
    except ValueError:
        q = 0
    if item.get("unit") == "גרם" and q >= 30:
        return q
    if item.get("unit") == "קילוגרם" and 0 < q <= 25 and not item.get("weighted"):
        return q * 1000
    n = clean(item.get("name", ""))
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:קג|קילו)\b", n)
    if m:
        return float(m.group(1)) * 1000
    m = re.search(r"\b(\d{2,4})\s*(?:גרם|גר|ג)\b", n)
    return float(m.group(1)) if m else None


def index(items: dict) -> dict:
    """{commodity: [(code, item)]} plus {"eggs": [...]}, once per branch."""
    out: dict[str, list] = {}
    for code, it in items.items():
        k = classify(it["name"])
        if k:
            out.setdefault(k, []).append((code, it))
        elif egg_spec(it["name"]):
            out.setdefault("eggs", []).append((code, it))
    return out


def _compatible(ref: str, cand: str) -> bool:
    for w in EXACT_WORDS:
        if (w in ref) != (w in cand):
            return False
    for w in VARIETIES:
        if w in ref and w not in cand:
            return False
    for pat in COLORS.values():
        if re.search(pat, ref) and not re.search(pat, cand):
            return False
    return True


def _rank(ref: str, cand: str) -> tuple:
    packed = ("ארוז" in ref) == ("ארוז" in cand)
    premium = bool(re.search("פרימיום|פרמיום|גורמה", ref)) == bool(re.search("פרימיום|פרמיום|גורמה", cand))
    plain = cand
    for word, usual in (("קישוא", "ירוק"), ("תפוא", "לבן|לבנ"), ("תפוח אדמה", "לבן|לבנ")):  # the plain one IS green / white
        if word in cand:
            plain = re.sub(usual, "", cand)
    color = not any(re.search(p, plain) for p in COLORS.values()) or any(re.search(p, ref) for p in COLORS.values())
    return premium, packed, color, round(SequenceMatcher(None, ref, cand).ratio(), 2)


def find(ref: dict, kinds: dict, weighted_line: bool = False) -> tuple[str, float] | None:
    """The same thing in another branch: (its code, its price in the receipt line's unit)."""
    name = clean(ref["name"])
    spec = egg_spec(ref["name"])
    if spec:
        cands = [(c, it) for c, it in kinds.get("eggs", []) if egg_spec(it["name"]) == spec]
        if not cands:
            return None
        c, it = min(cands, key=lambda x: x[1]["price"])
        return c, it["price"]
    kind = classify(ref["name"])
    if not kind:
        return None
    is_kg, g = per_kg(ref) or weighted_line, grams(ref)
    priced = []
    for c, it in kinds.get(kind, []):
        cn = clean(it["name"])
        if not _compatible(name, cn):
            continue
        if per_kg(it):
            p = it["price"] if is_kg else it["price"] * g / 1000 if g else None
        elif grams(it):
            p = it["price"] / grams(it) * 1000 if is_kg else it["price"] / grams(it) * g if g else None
        else:
            p = it["price"] if not is_kg and not g and SequenceMatcher(None, name, cn).ratio() >= 0.7 else None
        if p and ref["price"] / 3 <= p <= ref["price"] * 3:  # outside this the file is wrong or it's another product
            priced.append((_rank(name, cn), -p, c))
    if not priced:
        return None
    _, neg, code = max(priced)
    return code, round(-neg, 2)
