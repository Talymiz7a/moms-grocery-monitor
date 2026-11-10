#!/usr/bin/env python3
"""Cases that must never break. Run: python test_equivalents.py"""
import equivalents as e

KG = {"weighted": True, "unit": "קילוגרם", "qty": "1"}
def item(name, price, **kw): return {"name": name, "price": price, **KG, **kw}
def pack(name, price, g): return {"name": name, "price": price, "weighted": False, "unit": "גרם", "qty": str(g)}

assert e.classify("בננה מובחרת") == "בננה"
assert e.classify("ספרינג תות בננה 1.5") is None           # a drink is not a banana
assert e.classify("בננה ציפס תפזורת") is None
assert e.classify('תפו"א פרימיום פלוס') == "תפוח אדמה"
assert e.classify("תפוח עץ גאלה") == "תפוח"
assert e.classify("בורקס תפוא") is None
assert e.classify("שריר עגל טרי") is None and e.classify("שרי לובלו אדום ארוז") == "עגבניות שרי"
assert e.egg_spec("12 ביצים M מ.לסר") == (12, "M", False) == e.egg_spec("ביצים בינוני M12") == e.egg_spec("ביצים 12 יח בינוני M")
assert e.egg_spec("אטריות ביצים 12") is None and e.egg_spec("12 ביצים M אורגני")[2]

for not_fresh in ("בננית 300 גרם", "בננהוט חמאת שיזוף 150גרם", "בננה מסוכרת 200 גרם", "מנגולד ארוז", "לימונדה טבעית", "ענבר 500",
                  "קיווי משחת נעליים", "שום גבישי 120 גרם", "ברוקולי מוקפא 800 גרם", "חציל במיונז 400 גרם", "פלפל גרוס מתוק",
                  "עגבניות מרוסקות 600", "אננס חתוך טעמן 850", "תות קריסטל 2 ליטר", "תפוח נפתח 30 סמ"):
    assert e.classify(not_fresh) is None, not_fresh
for name, kind in (("בננות", "בננה"), ("מנגו", "מנגו"), ("לימון", "לימון"), ("אבטיח ללא גרעינים", "אבטיח"), ("בצל יבש", "בצל"), ("שום יבש", "שום"), ("ענבים ירוקים", "ענבים")):
    assert e.classify(name) == kind, name
assert not e.same_product("בננה", "מיץ בננה") and not e.same_product("מיץ בננה", "בננה מובחרת")  # the word alone is not the product
assert not e.same_product("חלב תנובה 3%", "שוקו חלב תנובה 1 ליטר")
assert e.same_product("בננה מובחרת", "בננות") and e.same_product("12 ביצים M מ.לסר", "12 ביצי משק טריות M לסר")
assert e.same_product("תנובה קוטג 5%", "קוטג תנובה 5% 250 גרם")

assert e.same_code_same_thing("במבה 80 גרם אסם", "אסם במבה 80 גר") and e.same_code_same_thing("נס קפה רד מאג 200 גרם", "נסקפה רד מאג 200ג")
assert e.same_code_same_thing("קישוא", "קישוא ירוק") and not e.same_code_same_thing("קישוא", "גזר") and not e.same_code_same_thing("שמפו 750", "במבה 80")

store = {"a": item("קישוא ירוק", 8.9), "b": item("קישוא זוקיני צהוב", 7.0), "c": item("קישוא עגול", 6.0),
         "d": item("פלפל אדום", 12.9), "e": item("פלפל צהוב", 9.9), "f": item("בננה", 7.9), "g": item("ספרינג בננה", 8.7),
         "h": item("ביצים 12 יח בינוני M", 13.1, weighted=False, unit="יחידות"), "i": item("חסה ערבית", 6.0),
         "j": pack("גזר ארוז 1 קג", 5.0, 1000), "k": pack("עגבניות שרי ארוז", 10.0, 500)}
k = e.index(store)
assert e.find(item("קישוא", 13.9), k)[0] == "a"            # not the yellow one, not the round one
assert e.find(item("קישוא", 13.9), e.index({"a": item("קישואים זוקיני", 9.9), "b": item("קישוא ירוק", 8.9)}))[0] == "b"  # green is the plain one
assert e.find(item("תפוא פרימיום", 9.9), e.index({"a": item("תפוא אדום תפזורת", 5.9), "b": item("תפוא לבן תפזורת", 6.9)}))[0] == "b"  # white is the plain one
assert e.find(item("פלפל אדום", 14.9), k)[0] == "d"        # color has to match
assert e.find(item("בננה מובחרת", 14.9), k)[0] == "f"
assert e.find({"name": "12 ביצים M מ.לסר", "price": 13.4}, k)[0] == "h"
assert e.find(item("חסה דרלן", 30.9), k) is None           # washed pack is not a head of lettuce
assert e.find(item("גזר", 7.9), k)[1] == 5.0               # pack converted to a kilo price
assert e.find(pack("עגבניות שרי ארוז 250", 8.0, 250), k)[1] == 5.0  # same pack weight, half the kilo
# a ready-to-eat pack is not a loose avocado; a microwave potato is not a potato by the kilo
k2 = e.index({"a": item("אבוקדו", 9.9), "b": item("תפוח אדמה למיקרוגל", 15.5)})
assert e.find(pack("אבוקדו בשל מארז", 10.9, 400), k2) is None
assert e.find(item("תפוא פרימיום פלוס", 9.9), k2) is None
print("OK")
