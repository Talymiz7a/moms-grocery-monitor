#!/usr/bin/env python3
"""Decisions that must never break. Run: python test_advisor.py"""
import advisor as a

def st(key, km, total, amounts, ll=(32.0, 34.8), loc="verified", promos=None, why=None):
    return {"key": key, "he": key, "chain": key.split(":")[0], "info": {"name": key}, "km": km, "ll": ll, "loc": loc, "stale": False,
            "total": total, "amount": dict(enumerate(amounts)), "why": why or {}, "promos": promos}
def line(i, name, paid, keys, qty=1.0, weighted=False, shelf=10.0, code="c"):
    return {"name": name, "paid": paid, "qty": qty, "weighted": weighted, "picked": {}, "shelf": {k: shelf for k in keys}, "how": {k: "barcode" for k in keys}, "codes": {k: code for k in keys}}
place = lambda s: {"address": "הרצל 1, תל אביב", "address_source": "file", "waze": "w", "google": "g"}
price = lambda s, ls: ({i: 0.0 for i in range(len(ls))}, {})

def run(stores, paid=100.0, n=2, home=0):
    keys = [s["key"] for s in stores]
    ls = [line(i, f"מוצר {i}", paid / n, keys) for i in range(n)]
    idx = {id(l): i for i, l in enumerate(ls)}
    def p(s, sub): return ({idx[id(l)]: s["amount"][idx[id(l)]] for l in sub}, {})
    return a.advise(ls, idx, stores, stores[home], paid, place, p, (32.0, 34.8))

r = run([st("h:1", 0.5, 100, [50, 50]), st("a:1", 4.5, 80, [40, 40]), st("b:1", 1.0, 85, [42.5, 42.5])])
assert r["go"] and r["recommended"]["key"] == "b:1"           # 15-1 beats 20-8: cheapest isn't automatically the recommendation
assert r["cheapest"]["key"] == "a:1" and r["recommended"]["trip_cost"] == 1.0 and r["recommended"]["net"] == 14.0
r = run([st("h:1", 0.5, 100, [50, 50]), st("a:1", 6.0, 92, [46, 46])])
assert not r["go"] and r["recommended"]["key"] == "h:1" and r["yearly"] is None  # 8 saved, 11 to get there: stay
r = run([st("h:1", 0.5, 100, [50, 50]), st("a:1", 0.2, 99, [49.5, 49.5])])
assert not r["go"]                                             # 1 shekel isn't worth moving for
r = run([st("h:1", 0.5, 200, [100, 100]), st("a:1", 0.5, 150, [40, 110]), st("b:1", 0.5, 150, [110, 40])], paid=200.0)
assert r["split"] and r["split"]["total"] == 80.0 and {s["key"] for s in r["split"]["stops"]} == {"a:1", "b:1"}
r = run([st("h:1", 0.5, 100, [50, 50]), st("a:1", 0.5, 90, [45, 45]), st("b:1", 0.5, 90, [44, 46])])
assert r["split"] is None                                      # a few shekels don't pay for a second stop
# a deal one unit away, and one that is already used by another deal
deal = {"by_item": {"c": ["p"]}, "promos": {"p": {"id": "p", "desc": "2 ב-12", "min": 2, "price": 12.0, "club": False, "limit": 0, "end": "20.11"}}}
s = st("a:1", 1.0, 10, [10.0], promos=deal)
l = line(0, "מוצר", 10, ["a:1"], shelf=10.0)
t = a._promo_tips([l], {id(l): 0}, s)
assert t and t[0]["add"] == 1 and t[0]["extra"] == 2.0 and t[0]["gain"] == 8.0
x, y = line(0, "שמפו", 10, ["a:1"], code="c"), line(1, "מרכך", 10, ["a:1"], code="c")
assert a._promo_tips([x, y], {id(x): 0, id(y): 1}, s) == []     # one each already fills a "2 for" across the two products
w = line(0, "מוצר", 10, ["a:1"], qty=0.5, weighted=True)
assert a._promo_tips([w], {id(w): 0}, s) == []                  # sold by weight: no units to add
assert "100%" in a.DISCLAIMER and "עלולה לטעות" in a.DISCLAIMER
print("OK")
