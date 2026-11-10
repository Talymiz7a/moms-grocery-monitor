#!/usr/bin/env python3
"""Compare a receipt against every supermarket within a radius, from the chains' official files.

    python compare.py --receipt receipt.json --home shufersal:229 --radius 5 --out result.json
    python compare.py --receipt receipt.json --home shufersal:229 --near "הרצל 10, רמת גן" --radius 3 --out result.json
    python compare.py --receipt receipt.json --home shufersal:229 --store ramilevy:016 --store osherad:024 --out result.json

How a receipt line becomes a product:
  1. barcode printed on the receipt → done.
  2. otherwise, in the HOME branch's file: same price (±1 agora) + the most similar name.
  3. with the barcode, every other branch is a direct lookup.
  4. fruit, vegetables and eggs have chain-internal codes: the same commodity per kilo, marked "equiv".
  5. anything else without that barcode gets a strict name match, marked "name".

Every branch in the radius is downloaded and reported. The basket is the set of lines that gives the
most value across the most branches; a branch missing one of those lines is listed as partial, with
how it compares to the receipt's branch on the lines it does carry.

What is compared: the same items in every branch, each priced with the promotions open to everyone
(multi-buys and fixed prices from the PromoFull file). Club deals are reported separately. Coupons,
gifts and minimum-spend deals are never counted. What you actually paid (including discounts printed
on the receipt) is the baseline.
"""
from __future__ import annotations

import argparse
import json
import sys
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote

import requests

import advisor
import chains
import equivalents
import geo
from geo import km

NUM = re.compile(r"\d+(?:\.\d+)?")
SKIP_BRANCH = re.compile(r"אינטרנט|מרלוג|משלוחים|אונליין|online|\bBE\b", re.I)  # BE = Shufersal's pharmacies
NOT_PRODUCT = re.compile(r"^שקית|פיקדון|פקדון|משלוח|^\W*$")
TARE = re.compile(r"ניכוי|אריזה|טרה")
DISCOUNT_WORDS = {"הנחה", "הנחת", "עבור", "מבצע", "מבצעים", "מועדון", "קופון", "זיכוי"}
BIG_CITIES = {"תל אביב", "ירושלים", "חיפה", "ראשון לציון", "פתח תקווה", "באר שבע", "אשדוד", "נתניה"}
_table_file = Path(__file__).with_name("branch_locations.json")
TABLE = json.loads(_table_file.read_text(encoding="utf-8")) if _table_file.exists() else {}  # pre-computed branch locations


def norm(s: str) -> str:
    s = s.replace('"', "").replace("'", "").replace("*", " ").replace("%", " % ")
    s = re.sub(r"(\d)([^\d\s.])", r"\1 \2", s)
    s = re.sub(r"([^\d\s.])(\d)", r"\1 \2", s)
    return re.sub(r"\s+", " ", s).strip()


def sim(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    ta, tb = set(a.split()), set(b.split())
    jac = len(ta & tb) / max(1, len(ta | tb))
    pre = SequenceMatcher(None, a, b[: len(a) + 2]).ratio()  # receipts cut names
    nums_ok = 1.0 if set(NUM.findall(a)) <= set(NUM.findall(b)) else 0.75
    return (0.45 * pre + 0.55 * jac) * nums_ok


def match_home(line: dict, items: dict) -> tuple[str | None, float]:
    bc = (line.get("barcode") or "").lstrip("0")
    if bc and bc in items:
        return bc, 1.0
    up = float(line.get("unit_price") or line.get("total") or 0)
    same_price = [(c, it) for c, it in items.items() if abs(it["price"] - up) < 0.011 and equivalents.same_product(line["name"], it["name"])]
    pool = same_price if same_price else list(items.items())
    best, score = None, 0.0
    for code, it in pool:
        s = sim(line["name"], it["name"]) + (0.15 if same_price else 0)
        if s > score and (same_price or equivalents.same_product(line["name"], it["name"])):
            best, score = code, s
    return (best, score) if score >= 0.45 else (None, score)


def match_name(name: str, items: dict) -> tuple[str | None, float]:
    best, score = None, 0.0
    words = [w for w in norm(name).split() if len(w) >= 3 and not w.isdigit()]
    for code, it in items.items():
        if not any(w in it["name"] for w in words):  # names without a shared word can't reach the threshold
            continue
        s = sim(name, it["name"])
        if s > score and equivalents.same_product(name, it["name"]):
            best, score = code, s
    return (best, score) if score >= 0.72 else (None, score)


# ---------------------------------------------------------------- where
def resolved_city(s: dict) -> str:
    city = geo.city_name(s.get("city", ""))
    if city in ("0", "unknown") or city.isdigit():
        city = ""
    if not city:
        nm = (s.get("name", "").replace('ת"א', "תל אביב").replace("ת״א", "תל אביב")
              .replace('ר"ג', "רמת גן").replace('ב"ש', "באר שבע"))
        for c in sorted(geo.CITY_CODES.values(), key=len, reverse=True):
            if c in nm:
                return c
    return city


def has_address(s: dict) -> bool:
    a = s.get("address", "")
    return bool(a) and a.lower() != "unknown" and not a.startswith("http")


# A branch named after a region is there, even if a street nearby happens to share the name
REGIONS = {"עמק חפר": (32.35, 34.92), "גוש עציון": (31.65, 35.12), "גולן": (33.0, 35.75), "גליל": (32.9, 35.4),
           "שומרון": (32.2, 35.2), "בנימין": (31.9, 35.25), "ערבה": (30.5, 35.15), "נגב": (31.0, 34.8)}


def wrong_region(s: dict, center, radius: float) -> bool:
    text = f'{s.get("name", "")} {s.get("address", "")}'
    return any(re.search(rf"(?<!\w){r}(?!\w)", text) and km(center, ll) > radius + 15 for r, ll in REGIONS.items())


APPROX: set[tuple[str, str]] = set()  # located by street only, without the house number


def address_variants(addr: str) -> tuple[list[str], str | None]:
    """The ways a branch address may be findable, and the street alone as a last resort."""
    a = re.sub(r"\s+", " ", re.sub(r"רח['׳]?\s+|רחוב\s+", "", addr)).strip()
    a = re.split(r"\s+פינת\s+|,|\s+מ\.?מסחרי|\s+מרכז מסחרי|\s+ק\.שר", a)[0].strip()
    a = re.sub(r"\bשד\.\s*", "שדרות ", a)
    m = re.match(r"^(\d+[א-ת]?)\s+(.+)$", a)  # "121 שדרות ירושלים" → "שדרות ירושלים 121"
    if m:
        a = f"{m.group(2)} {m.group(1)}"
    street = re.sub(r"\s*\d+[א-ת]?$", "", a).strip()
    return list(dict.fromkeys(x for x in (addr, a) if x)), (street if street and street != a else None)


def place_of(st: dict) -> dict:
    """The address a person can drive to, and links that open it. Never an invented one."""
    info, ll, city = st["info"], st["ll"], resolved_city(st["info"])
    text, source = None, "none"
    if has_address(info):
        text, source = re.sub(r"\s+", " ", info["address"]).strip(" ,"), "file"
        m = re.match(r"^(\d+[א-ת]?)\s+(.+)$", text)  # "22 לח"י" → "לח"י 22"
        if m:
            text = f"{m.group(2)} {m.group(1)}"
        if city and city not in text:
            text = f"{text}, {city}"
    elif ll:
        text = geo.reverse(ll)
        source = "map" if text else "none"
    query = ", ".join(x for x in (st["he"], text or info.get("name", "")) if x)
    exact = bool(ll) and st["loc"] in ("verified", "manual")
    if not ll and not text:
        return {"address": None, "address_source": "none", "waze": None, "google": None}
    return {"address": text, "address_source": source,
            "waze": f"https://waze.com/ul?ll={ll[0]},{ll[1]}&navigate=yes" if exact else f"https://waze.com/ul?q={quote(query)}&navigate=yes",
            "google": "https://www.google.com/maps/search/?api=1&query=" + (f"{ll[0]},{ll[1]}" if exact else quote(query))}


def locate(chain: str, s: dict, box=None) -> tuple[float, float] | None:
    """Branch → (lat, lon): the street address, then the shop itself on the map. Never a guess."""
    city = resolved_city(s)
    nm = s.get("name", "").replace('ת"א', "").replace("ת״א", "")
    words = " ".join(re.sub(r"[-()\d]", " ", nm.replace(city, "")).split())
    words = words.replace(chains.CHAINS[chain]["he"], "").strip()
    tries, street = [], None
    if has_address(s):
        tries, street = address_variants(s["address"])
    tries.append(f'{chains.CHAINS[chain]["he"]} {words}'.strip())
    if words and city:  # with no city, a branch name can only hit a street that happens to share it
        tries.append(re.sub(r"(סיטי|מרקט|קרפור|דיל|שלי|אקספרס)\s*", "", words).strip())  # "קניון גבעתיים"
    for q in dict.fromkeys(t for t in tries if t):
        if not city and not box:
            continue
        ll = geo.geocode(q, city or "", city_fallback=False, box=None if city else box)
        if ll:
            return ll
    if street and city:
        ll = geo.geocode(street, city, city_fallback=False)
        if ll:
            APPROX.add((chain, s["id"]))
            return ll
    return None


def store_info(chain: str, sid: str) -> dict:
    for s in chains.stores(chain):
        if s["id"] == f"{int(sid):03d}":
            return s
    return {"id": sid, "name": "", "city": "", "address": ""}


def verify(chain: str, ll, pois: dict):
    """If the same chain has a shop mapped within 400m, the branch is confirmed and pinned to it."""
    near = [(km(ll, p), p) for p in pois.get(chain, [])]
    if near:
        d, p = min(near)
        if d <= 0.4:
            return tuple(p), "verified"
    return ll, "address"


def in_radius(center, radius: float, chain_list: list[str], pois: dict, skip: set) -> tuple[list, list]:
    """All branches within the radius. Far cities are dropped before any geocoding."""
    found, unlocated = [], []
    box = (center[0], center[1], radius + 1)
    for chain in chain_list:
        for s in chains.stores(chain):
            if (chain, s["id"]) in skip or SKIP_BRANCH.search(s.get("name", "")) or s.get("address", "").startswith("http"):
                continue
            city = resolved_city(s)
            if city:
                cc = geo.city_center(city)
                if cc and km(center, cc) > radius + (9 if city in BIG_CITIES else 5):
                    continue
            known = TABLE.get(f'{chain}:{s["id"]}')
            if known:
                ll, how = (known[0], known[1]), known[2]
            else:
                ll = locate(chain, s, box)
                if not ll:
                    if city:
                        unlocated.append(f'{chains.CHAINS[chain]["he"]} {s.get("name", "")}'.strip())
                    continue
                ll, how = verify(chain, ll, pois)
                if how == "address" and (chain, s["id"]) in APPROX:
                    how = "street"
            d = km(center, ll)
            if d <= radius and wrong_region(s, center, radius):  # even "verified": a name search can land on another shop of the chain
                continue
            if d <= radius:
                found.append({"chain": chain, "store": s["id"], "info": s, "ll": ll, "loc": how, "km": round(d, 2)})
    found.sort(key=lambda x: x["km"])
    seen = set()  # one shop on the map confirms one branch: the closest match keeps "verified"
    for st in found:
        k = (st["chain"], st["ll"])
        if st["loc"] == "verified" and k in seen:
            st["loc"] = "address"
        seen.add(k)
    return found, unlocated


# ---------------------------------------------------------------- promotions
def apply_promos(lines: list[tuple[int, str, float, float]], pr: dict | None, club: bool) -> tuple[dict, dict]:
    """lines = (index, barcode, qty, shelf). Returns ({index: amount after promo}, {index: promo text}).
    Each line uses one promo at most: the deals that save the most are applied first."""
    amount = {i: q * s for i, _, q, s in lines}
    if not pr:
        return amount, {}
    ids = {p for _, c, _, _ in lines for p in pr["by_item"].get(c, [])}
    deals = [pr["promos"][p] for p in ids if club or not pr["promos"][p]["club"]]

    def plan(p, used):
        ls = [l for l in lines if l[0] not in used and p["id"] in pr["by_item"].get(l[1], []) and l[2] == int(l[2])]
        n = int(sum(l[2] for l in ls)) // p["min"]
        if p["limit"] > 0:
            n = min(n, p["limit"])
        if n <= 0:
            return 0.0, []
        units, take, value = n * p["min"], [], 0.0
        for l in sorted(ls, key=lambda x: -x[3]):  # the discount covers the most expensive units first
            t = min(units, int(l[2]))
            if t <= 0:
                break
            take.append((l, t))
            value += t * l[3]
            units -= t
        return value - n * p["price"], take

    used, why = set(), {}
    while True:
        gain, pid = max(((plan(p, used)[0], p["id"]) for p in deals), default=(0.0, None))
        if gain <= 0.005:
            return amount, why
        p = pr["promos"][pid]
        _, take = plan(p, used)
        value = sum(t * l[3] for l, t in take)
        for l, t in take:
            amount[l[0]] -= gain * (t * l[3]) / value
            why[l[0]] = p["desc"]
            used.add(l[0])


def fetch(st: dict, final: bool) -> None:
    """A branch's price and promotion files. Only the final attempt may settle for an older copy or no promotions."""
    pf = chains.price_full(st["chain"], st["store"], stale=final)
    st["file"], st["items"] = pf["file"], pf["items"]
    st["stale"] = date.today().strftime("%Y%m%d") not in pf["file"]
    try:
        st["promos"] = chains.promos(st["chain"], st["store"], stale=final)
        st["promo_file"] = st["promos"]["file"]
    except Exception:
        if not final:
            raise
        st["promos"], st["promo_file"] = None, None  # compared at shelf price; the output shows it


def fetch_all(stores: list[dict], say, rounds: int = 3) -> None:
    """Every branch, retrying until a round fixes nothing more. A portal failure never removes a branch silently."""
    chains.prepare([(s["chain"], s["store"]) for s in stores], say)
    done, lock, n = [0], threading.Lock(), len(stores)

    def one(st, final):
        try:
            st.pop("error", None)
            fetch(st, final)
        except Exception as e:
            st["error"] = str(e)[:160]
        with lock:
            done[0] += 1
            if done[0] % 15 == 0:
                say(f"ירדו {done[0]} קבצים מתוך {n}...")

    def chain_run(group, final):
        with ThreadPoolExecutor(max_workers=6 if group[0]["chain"] == "shufersal" else 3) as ex:
            list(ex.map(lambda s: one(s, final), group))

    pending = stores
    for r in range(rounds + 1):
        if r:
            say(f"ניסיון נוסף ל-{len(pending)} סניפים שלא ירדו...")
            time.sleep(10 * r)
            chains.refresh()
        groups: dict[str, list] = {}
        for st in pending:
            groups.setdefault(st["chain"], []).append(st)
        with ThreadPoolExecutor(max_workers=5) as ex:
            list(ex.map(lambda g: chain_run(g, r == rounds), groups.values()))
        pending = [s for s in pending if s.get("error")]
        if not pending:
            break


def same_barcode(l: dict, code: str, st: dict, home: dict) -> bool:
    """Codes under 8 digits are private to a chain: the same number elsewhere is another product. In the 72900000 range some are."""
    if code not in st["items"]:
        return False
    if st["chain"] == home["chain"]:
        return True
    if len(code) < 8:
        return False
    return not code.startswith("72900000") or equivalents.same_code_same_thing(home["items"][code]["name"], st["items"][code]["name"])


def pick_basket(known: list[dict], stores: list[dict], home_chain: str) -> list[dict]:
    """The lines worth comparing: as much of the receipt's value, across as many branches, as possible.
    A basket another chain can be compared on always beats one only the receipt's own chain carries."""
    total = sum(l["gross"] for l in known) or 1
    order = sorted(known, key=lambda l: -sum(1 for s in stores if s["key"] in l["shelf"]))
    best, score = [], (False, -1.0)
    for k in range(len(order), 0, -1):
        lines = order[:k]
        complete = [s for s in stores if all(s["key"] in l["shelf"] for l in lines)]
        v = (any(s["chain"] != home_chain for s in complete), round(sum(l["gross"] for l in lines) / total * len(complete) / len(stores), 9))
        if len(complete) >= 2 and v > score:
            best, score = lines, v
    return best


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Hebrew on Windows consoles
    ap = argparse.ArgumentParser()
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--home", required=True, help="chain:store of the receipt, e.g. shufersal:229")
    ap.add_argument("--radius", type=float, default=5.0, help="km around --near (default 5)")
    ap.add_argument("--near", help="address, e.g. 'הרצל 10, רמת גן'. Default: the branch on the receipt")
    ap.add_argument("--store", action="append", default=[], help="compare exactly these chain:store (skips the radius)")
    ap.add_argument("--chains", default=",".join(chains.CHAINS))
    ap.add_argument("--per-chain", type=int, default=0, help="only the N closest branches of each chain (default: all of them)")
    ap.add_argument("--retries", type=int, default=3, help="extra download rounds for branches that failed (default 3)")
    ap.add_argument("--loc", action="append", default=[], help="fix a branch location: chain:store=lat,lon")
    ap.add_argument("--km-cost", type=float, default=advisor.KM_COST, help="estimated ₪ per straight-line km of driving (default 1)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rec = json.loads(Path(a.receipt).read_text(encoding="utf-8"))
    hc, hs = a.home.split(":")
    hs = f"{int(hs):03d}"
    fixed = {}
    for x in a.loc:
        k, v = x.split("=")
        ch, sid = k.split(":")
        fixed[(ch, f"{int(sid):03d}")] = tuple(float(n) for n in v.split(","))

    say = lambda m: print(m, flush=True)
    say("מאתר את הסניפים באזור...")
    # --------- where to look
    hinfo = store_info(hc, hs)
    home_ll = fixed.get((hc, hs)) or tuple(TABLE.get(f"{hc}:{hs}", [None, None])[:2]) or None
    if not home_ll or home_ll[0] is None:
        home_ll = locate(hc, hinfo, None)
    center = home_ll
    near_home = False
    if a.near:
        addr, _, city = a.near.rpartition(",")
        center = geo.geocode(addr.strip(), city.strip(), city_fallback=False) if addr else geo.geocode(a.near, "ישראל", False)
        if not center:
            raise SystemExit(f"לא מצאתי את הכתובת: {a.near}. כתוב רחוב, מספר ועיר, למשל: הרצל 10, רמת גן")
        if not home_ll:  # the file's address is unusable, but the receipt's own address is known
            home_ll, near_home = center, True
    aliases = {c: chains.CHAINS[c]["osm"] for c in a.chains.split(",")}
    unlocated, truncated = [], 0
    if a.store:
        pois = geo.brand_pois(center, 15, aliases) if center else {}
        others = []
        for x in a.store:
            c, s = x.split(":")
            sid, info = f"{int(s):03d}", store_info(c, s)
            ll = fixed.get((c, sid)) or (tuple(TABLE[f"{c}:{sid}"][:2]) if f"{c}:{sid}" in TABLE else locate(c, info, None))
            ll, how = verify(c, ll, pois) if ll else (ll, "none")
            others.append({"chain": c, "store": sid, "info": info, "ll": ll, "loc": how,
                           "km": round(km(center, ll), 2) if center and ll else None})
    else:
        if not center:
            raise SystemExit("לא הצלחתי למקם את הסניף שעל הקבלה. הוסף --near 'רחוב ומספר, עיר'")
        pois = geo.brand_pois(center, a.radius + 1, aliases)
        others, unlocated = in_radius(center, a.radius, a.chains.split(","), pois, {(hc, hs)})
        for st in others:
            if (st["chain"], st["store"]) in fixed:
                st["ll"], st["loc"] = fixed[(st["chain"], st["store"])], "manual"
        if a.per_chain:
            seen: dict[str, int] = {}
            near = [st for st in others if seen.setdefault(st["chain"], 0) < a.per_chain and not seen.__setitem__(st["chain"], seen[st["chain"]] + 1)]
            truncated, others = len(others) - len(near), near
    home_ll2, how = verify(hc, home_ll, pois) if home_ll else (None, "none")
    if how == "address" and f"{hc}:{hs}" in TABLE:
        how = TABLE[f"{hc}:{hs}"][2]
    if near_home and how == "address":
        how = "manual"
    stores = [{"chain": hc, "store": hs, "info": hinfo, "ll": home_ll2, "loc": how,
               "km": round(km(center, home_ll2), 2) if center and home_ll2 else None}] + others

    say(f"נמצאו {len(stores) - 1} סניפים ברדיוס. מוריד את כל קובצי המחירים, בפעם הראשונה ביום זה לוקח כ-10 דקות...")
    # --------- every branch, including the receipt's own
    fetch_all(stores, say, a.retries)
    if stores[0].get("error"):
        raise SystemExit("לא הצלחתי להוריד את קובץ המחירים של הסניף שעל הקבלה. נסה שוב בעוד כמה דקות. מה שכבר ירד נשמר.")
    home = stores[0]
    failed = [s for s in stores if s.get("error")]
    stores = [s for s in stores if not s.get("error")]
    for st in stores:
        st["key"], st["he"] = f'{st["chain"]}:{st["store"]}', chains.CHAINS[st["chain"]]["he"]
        st["kinds"] = equivalents.index(st["items"])

    # --------- the receipt
    lines, shared = [], 0.0
    for ln in rec["lines"]:
        tot = float(ln.get("total") or 0)
        if ln.get("discount") or tot < 0:
            prev = lines[-1] if lines else None
            words = {w[:4] for w in norm(ln["name"]).split() if len(w) >= 3 and w not in DISCOUNT_WORDS}
            if prev and (TARE.search(ln["name"]) or words & {w[:4] for w in norm(prev["name"]).split()}):
                prev["disc"] += tot  # receipts print a deal right under the product it belongs to
                if TARE.search(ln["name"]) and prev["weighted"] and prev["unit"]:
                    prev["qty"] = round(prev["qty"] + tot / prev["unit"], 3)  # the packaging isn't bought elsewhere either
            else:
                shared += tot
            continue
        if tot == 0 or NOT_PRODUCT.search(ln["name"]):
            continue
        code, conf = match_home(ln, home["items"])
        lines.append({"name": ln["name"], "qty": float(ln.get("qty") or 1), "gross": round(tot, 2), "disc": 0.0,
                      "unit": float(ln.get("unit_price") or tot), "barcode": code, "match": round(conf, 2),
                      "weighted": bool(ln.get("weighted")), "shelf": {}, "how": {}, "codes": {}, "picked": {}})
    gross = sum(l["gross"] for l in lines) or 1
    for l in lines:  # discounts without a clear product are shared across the lines
        l["paid"] = round(l["gross"] + l["disc"] + l["gross"] * shared / gross, 2)
    discounts = round(shared + sum(l["disc"] for l in lines), 2)

    # --------- each line in each branch: barcode, then the same commodity, then a strict name
    for l in lines:
        if not l["barcode"]:
            continue
        ref = home["items"][l["barcode"]]
        fresh = equivalents.classify(ref["name"]) or equivalents.egg_spec(ref["name"])
        for st in stores:
            k = st["key"]
            if st is home or same_barcode(l, l["barcode"], st, home):
                l["shelf"][k], l["how"][k], l["codes"][k] = st["items"][l["barcode"]]["price"], "barcode", l["barcode"]
            elif fresh:
                hit = equivalents.find(ref, st["kinds"], l["weighted"])
                if hit:
                    l["shelf"][k], l["how"][k], l["codes"][k] = hit[1], "equiv", hit[0]
            else:
                c2, _ = match_name(ref["name"], st["items"])
                if c2:
                    l["shelf"][k], l["how"][k], l["codes"][k] = st["items"][c2]["price"], "name", c2
            if k in l["codes"]:
                l["picked"][k] = st["items"][l["codes"][k]]["name"]

    # built-in reliability check: do the receipt's own prices agree with the file?
    known = [l for l in lines if l["barcode"]]
    exact = [l for l in known if abs(home["items"][l["barcode"]]["price"] - l["unit"]) < 0.011]

    # --------- the basket every complete branch is ranked on; the others are compared on what they carry
    common = pick_basket(known, stores, hc)
    if not common:
        raise SystemExit("לא נמצאו מוצרים שנמכרים גם בסניפים אחרים. בדוק את הקבלה או הגדל את הרדיוס.")
    in_basket = {id(l) for l in common}
    idx = {id(l): i for i, l in enumerate(common)}
    complete = [s for s in stores if all(s["key"] in l["shelf"] for l in common)]
    outside = [s for s in stores if s not in complete]

    def priced(st, ls, club):
        basket = [(idx[id(l)], l["codes"][st["key"]], l["qty"], l["shelf"][st["key"]]) for l in ls]
        return apply_promos(basket, st["promos"], club=club)

    for st in complete:
        st["amount"], st["why"] = priced(st, common, False)
        st["shelf_total"] = round(sum(l["qty"] * l["shelf"][st["key"]] for l in common), 2)
        st["total"] = round(sum(st["amount"].values()), 2)
        st["total_club"] = round(sum(priced(st, common, True)[0].values()), 2)
    stores = complete
    partial = []
    for st in outside:
        ls = [l for l in common if st["key"] in l["shelf"]]
        here = round(sum(priced(st, ls, False)[0].values()), 2) if ls else 0
        there = round(sum(priced(home, ls, False)[0].values()), 2) if ls else 0
        partial.append({"key": st["key"], "he": chains.CHAINS[st["chain"]]["he"], "branch": st["info"].get("name", ""),
                        "km": st["km"], "loc": st["loc"], "carried": len(ls), "of": len(common), "total": here, "home_total": there,
                        "pct": round(100 * (here / there - 1), 1) if there else None,
                        "missing": [l["name"] for l in common if st["key"] not in l["shelf"]]})
    partial.sort(key=lambda x: (-x["carried"], x["pct"] if x["pct"] is not None else 999))
    paid = round(sum(l["paid"] for l in common), 2)
    paid_all = round(sum(l["paid"] for l in lines), 2)
    coverage = {"lines": len(common), "of": len(lines), "paid": paid, "paid_all": paid_all, "share": round(paid / paid_all, 3) if paid_all else 0}

    def why_out(l):
        return "unmatched" if not l["barcode"] else "home_chain_only" if {k.split(":")[0] for k in l["shelf"]} <= {hc} else "partial"

    rivals = [s for s in stores if s is not home]
    if not rivals:
        raise SystemExit("אף סניף אחר לא מחזיק את המוצרים האלה. נסה רדיוס גדול יותר.")
    best = min(rivals, key=lambda s: s["total"])
    best_club = min(rivals, key=lambda s: s["total_club"])
    shelf_best = min(rivals, key=lambda s: s["shelf_total"])
    for x in partial:  # the ranked winner on exactly the lines this branch carries
        x["best_total"] = round(sum(best["amount"][idx[id(l)]] for l in common if l["name"] not in x["missing"]), 2)
    same = [l for l in common if l["how"].get(best["key"]) == "barcode"]
    exact_part = {"lines": len(same), "paid": round(sum(l["paid"] for l in same), 2),
                  "best": round(sum(best["amount"][idx[id(l)]] for l in same), 2)}

    advice = advisor.advise(common, idx, stores, home, paid, place_of, lambda st, ls: priced(st, ls, False), center, a.km_cost)
    res = {
        "advice": advice, "disclaimer": advisor.DISCLAIMER,
        "receipt": {"chain": rec.get("chain"), "branch": rec.get("branch"), "date": rec.get("date"), "total": rec.get("total")},
        "center": center, "radius_km": None if a.store else a.radius,
        "stores": [{"key": s["key"], "chain": s["chain"], "he": chains.CHAINS[s["chain"]]["he"],
                    "color": chains.CHAINS[s["chain"]]["color"], "branch": s["info"].get("name", ""),
                    "address": s["info"].get("address", ""), "ll": s["ll"], "loc": s["loc"], "km": s["km"],
                    "file": s["file"], "promo_file": s["promo_file"], "shelf_total": s["shelf_total"],
                    "total": s["total"], "total_club": s["total_club"], "stale": s["stale"],
                    "equiv_lines": sum(1 for l in common if l["how"].get(s["key"]) == "equiv")} for s in stores],
        "coverage": coverage, "same_chain_only": all(s["chain"] == hc for s in rivals),
        "partial": partial, "exact_part": exact_part, "basket_lines": len(common), "basket_value_share": round(sum(l["gross"] for l in common) / gross, 3),
        "home": home["key"], "best": best["key"],
        "paid_common": paid, "receipt_discounts": round(discounts, 2),
        "saving": round(paid - best["total"], 2),
        "saving_shelf": round(home["shelf_total"] - shelf_best["shelf_total"], 2),
        "saving_club": round(home["total_club"] - best_club["total_club"], 2),
        "km_to_best": round(km(home["ll"], best["ll"]), 2) if home["ll"] and best["ll"] else None,
        "check": {"exact_prices": len(exact), "matched_lines": len(known), "all_lines": len(lines),
                  "file_home_total": home["total"], "receipt_vs_file": round(paid - home["total"], 2)},
        "lines": [dict(l, amounts={s["key"]: round(s["amount"][idx[id(l)]], 2) for s in stores},
                       promo={s["key"]: s["why"][idx[id(l)]] for s in stores if idx[id(l)] in s["why"]})
                  if id(l) in idx else l for l in lines],
        "not_compared": [{"name": l["name"], "paid": l["paid"], "branches_with_it": len(l["shelf"]), "of": len(complete) + len(outside), "reason": why_out(l)}
                         for l in lines if id(l) not in in_basket],
        "failed_downloads": [{"key": f'{s["chain"]}:{s["store"]}', "branch": s["info"].get("name", ""), "why": s["error"]} for s in failed],
        "truncated": truncated, "unlocated": unlocated,
    }
    Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    MARK = {"verified": "מאומת במפה", "address": "לפי כתובת", "street": "רחוב בלבד", "manual": "ידני", "none": "ללא מיקום"}
    checked = len(complete) + len(outside) - 1
    print(f"קבלה: {res['receipt']['chain']} {res['receipt']['branch']}  ({len(lines)} פריטים, {len(common)} בסל ההשוואה, {res['basket_value_share']:.0%} מהערך)")
    print(f"נבדק: רדיוס {a.radius:g} ק\"מ, {checked} סניפים ירדו, {len(complete) - 1} מחזיקים את כל הסל" if res["radius_km"] else f"נבדק: {checked} סניפים שנבחרו ביד")
    print(f'{"רשת":8} {"סניף":24} {"מדף":>9} {"מבצעים":>9} {"מועדון":>9} {"מרחק":>7}  מיקום')
    ranked = sorted(res["stores"], key=lambda s: s["total"])
    for s in [x for i, x in enumerate(ranked) if i < 20 or x["key"] == res["home"]]:
        dist = f'{s["km"]:5.1f}' if s["km"] is not None else "    ?"
        tag = "  ← הקבלה" if s["key"] == res["home"] else ""
        notes = ("  (בלי קובץ מבצעים)" if not s["promo_file"] else "") + ("  (קובץ ישן)" if s["stale"] else "")
        print(f'{s["he"]:8} {s["branch"][:24]:24} {s["shelf_total"]:9.2f} {s["total"]:9.2f} {s["total_club"]:9.2f} {dist} ק"מ  {MARK.get(s["loc"], s["loc"])}{tag}{notes}')
    if len(ranked) > 20:
        print(f"... ועוד {len(ranked) - 20} סניפים ב-result.json")
    he = chains.CHAINS[best["chain"]]["he"]
    print(f'\nשילמת על המוצרים שהושוו: {paid:.2f} ₪' + (f' (הנחות בקבלה {discounts:.2f})' if discounts else ""))
    full = coverage["lines"] == coverage["of"]
    print(f'הושווה בפועל: {coverage["lines"]} מתוך {coverage["of"]} מוצרים, {paid:.2f} מתוך {paid_all:.2f} ₪ ששולמו ({coverage["share"]:.0%}).' + ("" if full else " החיסכון שלמטה נכון רק לחלק הזה."))
    if res["same_chain_only"]:
        print(f'שימו לב: אף רשת אחרת לא מחזיקה את הסל הזה, אז ההשוואה היא רק בין סניפי {chains.CHAINS[hc]["he"]}.')
    verb = "פחות" if res["saving"] >= 0 else "יותר"
    print(f'אותו סל: {abs(res["saving"]):.2f} ₪ {verb} ב{he} {best["info"].get("name", "")}, עם מבצעים פתוחים לכולם')
    print(f'לפי מחירי מדף בלבד: {res["saving_shelf"]:.2f} ₪. אם יש לך מועדון בכל הרשתות: {res["saving_club"]:.2f} ₪')
    print(f'מתוך זה מוצרים זהים בברקוד: {exact_part["lines"]} שורות, שילמת {exact_part["paid"]:.2f} ₪, שם {exact_part["best"]:.2f} ₪.' + (' השאר שווה ערך (ירקות וביצים לפי סוג ומחיר לק"ג).' if exact_part["lines"] < len(common) else ""))
    print("\n".join(advisor.render(advice, coverage["lines"])))
    gap_pct = 100 * abs(res["check"]["receipt_vs_file"]) / max(paid, 1)
    print(f'\nאמינות: {len(exact)} מתוך {len(known)} מחירים בקבלה זהים למחיר המדף בקובץ. הסכום לפי הקובץ שונה מהקבלה ב-{res["check"]["receipt_vs_file"]:.2f} ₪ ({gap_pct:.1f}%)')
    low = [l["name"] for l in lines if l["match"] < 0.6]
    if low:
        print("לבדיקה (התאמה חלשה):", ", ".join(low))
    for reason, text in (("home_chain_only", "מותג פרטי או מוצר שנמכר רק ברשת של הקבלה"), ("partial", "נמכר רק בחלק מהסניפים"), ("unmatched", "לא זוהה בקובץ המחירים")):
        out = [x for x in res["not_compared"] if x["reason"] == reason]
        if out:
            print(f"לא הושווה, {text}:", ", ".join(f'{x["name"]} ({x["paid"]:.2f} ₪, {x["branches_with_it"]}/{x["of"]} סניפים)' for x in out))
    if partial:
        print(f"\nסניפים חלקיים ({len(partial)}), מול סניף הקבלה על מה שיש בהם:")
        for x in partial[:12]:
            pct = f'{x["pct"]:+.1f}%' if x["pct"] is not None else "?"
            print(f'  {x["he"]} {x["branch"][:26]}: {x["carried"]}/{x["of"]} מוצרים, {pct}, {x["total"]:.2f} ₪ מול {x["best_total"]:.2f} ₪ בזול בדירוג על אותם מוצרים, חסר: {", ".join(x["missing"][:3])}')
    stale = [s for s in res["stores"] if s["stale"]]
    if stale:
        print(f"{len(stale)} סניפים הושוו מקובץ של אתמול או שלשום, כי הקובץ של היום לא ירד.")
    if truncated:
        print(f"עוד {truncated} סניפים ברדיוס לא נבדקו בגלל --per-chain.")
    if unlocated:
        print(f"{len(unlocated)} סניפים לא נכנסו כי אי אפשר למקם אותם על המפה (--loc מוסיף): " + ", ".join(unlocated[:12]))
    if failed:
        none = [x for x in res["failed_downloads"] if "no PriceFull" in x["why"]]
        if none:
            print("סניפים שהרשת לא מפרסמת להם קובץ (בדרך כלל סניף שנסגר):", ", ".join(f'{x["key"]} {x["branch"]}' for x in none))
        if len(none) < len(failed):
            print("סניפים שלא ירדו גם אחרי כל הניסיונות:", ", ".join(x["key"] for x in res["failed_downloads"] if x not in none))
    if not a.store and not pois and not TABLE:
        print("מפת OpenStreetMap לא הייתה זמינה, ולכן אף סניף לא אומת מולה.")
    print(f"\n{advisor.DISCLAIMER}")


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException:
        raise SystemExit("הפורטל של אחת הרשתות לא עונה כרגע. נסו שוב בעוד 5-10 דקות. מה שכבר ירד נשמר.")
