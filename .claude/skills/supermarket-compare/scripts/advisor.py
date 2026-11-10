#!/usr/bin/env python3
"""From a ranked list of branches to a decision: where to go, whether the trip pays, what to buy there.

Works only on what compare.py already computed, so it needs no extra account, key or question.
Distances are straight lines from the search point, so the trip cost is an estimate and is labelled as one.
"""
from __future__ import annotations

import heapq
import re

from geo import km

KM_COST = 1.0  # ₪ per straight-line km, driving there or back: fuel and wear, on a road a bit longer than the line
WORTH_GOING = 3.0  # below this, after the trip, staying put is the honest advice
TIE = 1.0  # the trip is an estimate: within this, a branch confirmed on the map wins over a closer call
SPLIT_MIN = 10.0  # a second stop has to earn at least this much, and at least SPLIT_SHARE of the basket
SPLIT_SHARE = 0.05
DISCLAIMER = ("חשוב לדעת: המערכת עלולה לטעות ולא תמיד מדייקת ב-100%. היא נשענת על קובצי המחירים שהרשתות מפרסמות ועל קריאת הקבלה בידי AI, "
              "ומחירים, מבצעים, מלאי וכתובות יכולים להשתנות. זו הערכה ולא הבטחה לסכום בקופה, אז לפני נסיעה מיוחדת כדאי לוודא מול הסניף.")


def trip_cost(st: dict, home: dict, km_cost: float) -> float:
    """What it costs to go there instead of the branch on the receipt. A closer branch costs nothing extra."""
    if st["km"] is None or home["km"] is None:
        return 0.0
    return round(max(0.0, st["km"] - home["km"]) * 2 * km_cost, 2)


def display_name(st: dict) -> str:
    """"קרפור מרקט  תל כביר (1228)" → "קרפור מרקט תל כביר"; the chain's name once, and always."""
    branch = re.sub(r"\s+", " ", re.sub(r"\(\d+\)", "", st["info"].get("name", ""))).strip()
    return branch if st["he"] in branch else f'{st["he"]} {branch}'.strip()


def _card(st: dict, home: dict, paid: float, place, km_cost: float) -> dict:
    trip, saving = trip_cost(st, home, km_cost), round(paid - st["total"], 2)
    return {"key": st["key"], "name": display_name(st), "km": st["km"], "loc": st["loc"],
            "stale": st["stale"], "total": st["total"], "saving": saving, "trip_cost": trip, "net": round(saving - trip, 2), **place(st)}


def _shopping_list(common: list[dict], idx: dict, st: dict) -> list[dict]:
    k = st["key"]
    return [{"name": l["name"], "there": l["name"] if l["how"][k] == "barcode" else l["picked"].get(k, l["name"]), "qty": l["qty"], "weighted": l["weighted"], "shelf": l["shelf"][k],
             "amount": round(st["amount"][idx[id(l)]], 2), "how": l["how"][k], "promo": st["why"].get(idx[id(l)])} for l in common]


def _promo_tips(common: list[dict], idx: dict, st: dict) -> list[dict]:
    """A deal one or two units away: buying up to it lowers what each unit costs."""
    pr, tips = st["promos"], []
    if not pr:
        return tips
    k, units, seen = st["key"], {}, set()
    for l in common:  # a deal counts every unit it covers, across different products ("שמפו/מרכך 2 ב-20")
        if not l["weighted"] and l["qty"] == int(l["qty"]):
            for pid in pr["by_item"].get(l["codes"][k], []):
                units[pid] = units.get(pid, 0) + int(l["qty"])
    for l in common:
        if l["weighted"] or l["qty"] != int(l["qty"]):
            continue
        shelf, used, best = l["shelf"][k], st["why"].get(idx[id(l)]), None
        for pid in pr["by_item"].get(l["codes"][k], []):
            p = pr["promos"][pid]
            rem = units[pid] % p["min"]
            if pid in seen or p["club"] or p["min"] < 2 or rem == 0 or (used and used != p["desc"]) or (p["limit"] and units[pid] // p["min"] >= p["limit"]):
                continue
            need = p["min"] - rem
            extra = p["price"] - rem * shelf
            gain = need * shelf - extra
            if need <= 2 and extra > 0 and gain >= 2 and gain >= 0.15 * need * shelf and (best is None or gain > best["gain"]):
                best = {"pid": pid, "name": l["name"], "add": need, "extra": round(extra, 2), "gain": round(gain, 2), "desc": p["desc"], "end": p["end"]}
        if best:
            seen.add(best["pid"])
            tips.append(best)
    return sorted(tips, key=lambda t: -t["gain"])[:3]


def _promo_end(st: dict) -> str | None:
    """The first of the deals inside this total to run out."""
    pr = st["promos"]
    if not pr or not st["why"]:
        return None
    used = set(st["why"].values())
    ends = [p["end"] for p in pr["promos"].values() if p["desc"] in used and not p["club"]]
    return min(ends, key=lambda e: tuple(reversed(e.split(".")))) if ends else None


def _best_split(common, idx, stores, home, paid, price, center, km_cost, single_net, place) -> dict | None:
    """Two stops, when a second one earns its way. Promotions are priced again on what each stop really gets."""
    usable = [s for s in stores if s["ll"]]
    if not center or len(usable) < 2 or home["km"] is None:
        return None
    n = len(common)
    amounts = [[s["amount"][j] for j in range(n)] for s in usable]

    def route(a, b):
        return round(max(0.0, km(center, a["ll"]) + km(a["ll"], b["ll"]) + km(b["ll"], center) - 2 * home["km"]) * km_cost, 2)

    def rough():
        for i, a in enumerate(usable):
            for j in range(i + 1, len(usable)):
                yield paid - sum(map(min, amounts[i], amounts[j])) - route(a, usable[j]), i, j

    best = None
    for _, i, j in heapq.nlargest(8, rough()):
        a, b = usable[i], usable[j]
        at_a = [l for l in common if amounts[i][idx[id(l)]] <= amounts[j][idx[id(l)]]]
        at_b = [l for l in common if id(l) not in {id(x) for x in at_a}]
        if not at_a or not at_b:
            continue
        ta, tb = sum(price(a, at_a)[0].values()), sum(price(b, at_b)[0].values())
        trip, total = route(a, b), round(ta + tb, 2)
        net = round(paid - total - trip, 2)
        if best is None or net > best[0]:
            best = (net, total, trip, a, b, at_a, at_b, ta, tb)
    if best is None or best[0] - max(single_net, 0) < max(SPLIT_MIN, SPLIT_SHARE * paid):
        return None
    net, total, trip, a, b, at_a, at_b, ta, tb = best

    def stop(st, ls, sub):
        return {"key": st["key"], "name": display_name(st), "km": st["km"], "total": round(sub, 2),
                "items": [l["name"] for l in ls], **place(st)}

    return {"total": total, "trip_cost": trip, "net": net, "extra_vs_single": round(net - max(single_net, 0), 2),
            "stops": [stop(a, at_a, ta), stop(b, at_b, tb)]}


def advise(common: list[dict], idx: dict, stores: list[dict], home: dict, paid: float, place, price, center, km_cost: float = KM_COST) -> dict:
    """stores are the branches that carry the whole basket, the receipt's own included."""
    rivals = [s for s in stores if s is not home]
    located = [s for s in rivals if s["km"] is not None] or rivals
    net = lambda s: paid - s["total"] - trip_cost(s, home, km_cost)
    top_net = max(net(s) for s in located)
    top = min((s for s in located if net(s) >= top_net - TIE), key=lambda s: (s["loc"] not in ("verified", "manual"), s["total"]))
    go = net(top) >= WORTH_GOING
    rec = top if go else home
    cheapest = min(rivals, key=lambda s: s["total"])
    card = lambda s: _card(s, home, paid, place, km_cost)
    out = {"go": go, "km_cost": km_cost, "recommended": card(rec), "best_rival_net": round(net(top), 2),
           "cheapest": card(cheapest) if cheapest is not rec else None, "closer": None, "split": None,
           "biggest_gaps": [], "costlier_there": [], "tips": _promo_tips(common, idx, rec), "promos_until": _promo_end(rec),
           "shopping_list": _shopping_list(common, idx, rec), "yearly": None}
    if go:
        k, rec_saving = rec["key"], paid - rec["total"]
        near = [s for s in located if s is not rec and s["km"] < rec["km"] - 0.5 and paid - s["total"] >= 0.6 * rec_saving > 0]
        if near:
            out["closer"] = card(min(near, key=lambda s: (s["km"], s["total"])))
        gaps = sorted(((round(l["paid"] - rec["amount"][idx[id(l)]], 2), l) for l in common), key=lambda x: -x[0])
        row = lambda d, l: {"name": l["name"], "paid": l["paid"], "there": round(rec["amount"][idx[id(l)]], 2), "diff": d, "how": l["how"][k]}
        out["biggest_gaps"] = [row(d, l) for d, l in gaps[:5] if d >= 0.5]
        out["costlier_there"] = [row(d, l) for d, l in reversed(gaps[-3:]) if d <= -0.5]
        out["yearly"] = {"monthly": round(net(rec) * 12), "weekly": round(net(rec) * 52)}
    out["split"] = _best_split(common, idx, stores, home, paid, price, center, km_cost, net(rec) if go else 0.0, place)
    return out


# ---------------------------------------------------------------- what the person reads
def _where(c: dict) -> str:
    return c["address"] + (" (לפי המפה, הרשת לא פרסמה כתובת)" if c["address_source"] == "map" else "") if c["address"] else "הרשת לא פרסמה כתובת, כדאי לחפש לפי שם הסניף"


MARK = {"verified": "מאומת במפה", "address": "לפי כתובת, כדאי לוודא בניווט", "street": "רחוב בלבד, כדאי לוודא בניווט", "manual": "ידני", "none": "ללא מיקום"}


def render(a: dict, lines_compared: int) -> list[str]:
    r, out = a["recommended"], ["", "=== ההמלצה ==="]
    dist = f'{r["km"]:.1f} ק"מ בקו אווירי' if r["km"] is not None else "מרחק לא ידוע"
    if a["go"]:
        out.append(f'לאן: {r["name"]}')
    else:
        out.append(f'לאן: להישאר ב{r["name"]}. אף סניף אחר לא מכסה את הנסיעה (הטוב מביניהם: {a["best_rival_net"]:.2f} ₪ אחרי נסיעה).')
    out.append(f'כתובת: {_where(r)}')
    out.append(f'מרחק: {dist} ({MARK.get(r["loc"], r["loc"])})')
    if r["waze"]:
        out.append(f'ניווט: {r["waze"]}')
        out.append(f'גוגל מפות: {r["google"]}')
    if a["go"]:
        out.append(f'כדאיות: {r["saving"]:.2f} ₪ חיסכון על {lines_compared} המוצרים, פחות נסיעה משוערת של {r["trip_cost"]:.2f} ₪, נשארים {r["net"]:.2f} ₪.')
        out.append(f'אם חוזרים על אותו סל, על החלק שהושווה: בערך {a["yearly"]["monthly"]:,} ₪ בשנה בקנייה חודשית, {a["yearly"]["weekly"]:,} ₪ בקנייה שבועית.')
    if a["promos_until"]:
        out.append(f'חלק מהסכום נשען על מבצעים. הראשון שמסתיים: {a["promos_until"]}.')
    if r["stale"]:
        out.append("המחיר בסניף הזה מקובץ של אתמול או שלשום, כי הקובץ של היום לא ירד.")
    c = a["cheapest"]
    if c:
        out.append(f'הכי זול לפני נסיעה: {c["name"]}, {_where(c)}, {c["total"]:.2f} ₪ ({c["km"] if c["km"] is not None else "?"} ק"מ). נטו אחרי נסיעה: {c["net"]:.2f} ₪.')
    c = a["closer"]
    if c:
        out.append(f'אפשרות קרובה יותר: {c["name"]}, {_where(c)}, {c["km"]:.1f} ק"מ, חיסכון {c["saving"]:.2f} ₪.')
    s = a["split"]
    if s:
        x, y = s["stops"]
        out.append(f'שתי עצירות: עוד {s["extra_vs_single"]:.2f} ₪ נטו מעל עצירה אחת.')
        for st in (x, y):
            out.append(f'  {st["name"]}, {_where(st)}: {st["total"]:.2f} ₪ על {", ".join(st["items"][:8])}' + (f' ועוד {len(st["items"]) - 8}' if len(st["items"]) > 8 else ""))
    if a["biggest_gaps"]:
        out.append("איפה רוב החיסכון: " + ", ".join(f'{g["name"]} ({g["paid"]:.2f} מול {g["there"]:.2f})' for g in a["biggest_gaps"]))
    if a["costlier_there"]:
        out.append("יקר יותר שם: " + ", ".join(f'{g["name"]} ({g["paid"]:.2f} מול {g["there"]:.2f})' for g in a["costlier_there"]))
    for t in a["tips"]:
        out.append(f'טיפ מבצע: {t["name"]}: עוד {t["add"]} יח\' עולה רק {t["extra"]:.2f} ₪ וחוסך {t["gain"]:.2f} ₪ ({t["desc"]}, עד {t["end"]}). כדאי רק אם צריך את זה בכל מקרה.')
    out.append("")
    out.append(f'רשימת קניות ל{r["name"]}:')
    for x in a["shopping_list"]:
        qty = f'{x["qty"]:.3f} ק"ג' if x["weighted"] else f'{x["qty"]:g} יח\''
        tag = "  (שווה ערך)" if x["how"] != "barcode" else ""
        promo = f'  [{x["promo"]}]' if x["promo"] else ""
        out.append(f'  {x["there"]}, {qty}: {x["amount"]:.2f} ₪{tag}{promo}')
    return out
