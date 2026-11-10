#!/usr/bin/env python3
"""Download the price files Israeli supermarket chains must publish (חוק שקיפות המחירים, 2015).

Every chain is obliged to publish, for every branch, an XML file of all its prices
(PriceFull), a list of branches (Stores) and promotions. They sit on different portals:

  shufersal   prices.shufersal.co.il                 HTML table → links to Azure blob (.gz)
  cerberus    url.publishedprices.co.il              login with a public username, no password
              (רמי לוי, יוחננוף, אושר עד, טיב טעם ועוד)
  carrefour   prices.carrefour.co.il                 JSON list embedded in the page, files by date

Files are gzip'd XML (sometimes zip, sometimes UTF-16). This module hides all of that:

    from chains import CHAINS, stores, price_full
    stores("ramilevy")                 -> [{"id": "039", "name": ..., "city": ..., "address": ...}]
    price_full("ramilevy", "039")      -> {"7290000066318": {"name": ..., "price": 5.9, ...}}

CLI:
    python chains.py stores ramilevy [--city "תל אביב"]
    python chains.py prices ramilevy 039
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import re
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from lxml import etree

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
CACHE = Path(os.environ.get("SUPERMARKET_CACHE", Path.home() / ".supermarket-compare" / "cache"))

# name in Hebrew, portal kind, portal-specific key, brand color for the UI
CHAINS = {
    "shufersal": {"he": "שופרסל", "kind": "shufersal", "color": "#ff4d5a", "osm": ["שופרסל", "shufersal", "יש חסד", "יוניברס", "be "]},
    "ramilevy": {"he": "רמי לוי", "kind": "cerberus", "user": "RamiLevi", "color": "#4c8dff", "osm": ["רמי לוי", "rami levy", "rami levi"]},
    "yohananof": {"he": "יוחננוף", "kind": "cerberus", "user": "yohananof", "color": "#ffc93c", "osm": ["יוחננוף", "yohananof"]},
    "osherad": {"he": "אושר עד", "kind": "cerberus", "user": "osherad", "color": "#31d68f", "osm": ["אושר עד", "osher ad"]},
    "carrefour": {"he": "קרפור", "kind": "carrefour", "color": "#b18cff", "osm": ["קרפור", "carrefour", "מגה", "mega"]},
}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def _unpack(raw: bytes) -> bytes:
    """gz / zip / plain → XML bytes."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    elif raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            raw = z.read(z.namelist()[0])
    return raw


TIMEOUT = (15, 120)
SLOW_TIMEOUT = (20, 240)  # Shufersal's portal answers every request after 60-85 seconds, even a tiny one


def _get(s: requests.Session, url: str, tries: int = 2, wait=TIMEOUT, **kw) -> requests.Response:
    for i in range(tries):
        try:
            r = s.get(url, timeout=wait, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(2 + 3 * i)


# ---------------------------------------------------------------- portals
class Shufersal:
    BASE = "https://prices.shufersal.co.il"
    CAT = {"PriceFull": 2, "PromoFull": 4, "Stores": 5}

    def __init__(self, cfg):
        self.s = _session()
        self.index: dict[str, dict] = {}

    def _links(self, kind: str, sid: int, page: int) -> str:
        url = f"{self.BASE}/FileObject/UpdateCategory?catID={self.CAT[kind]}&storeId={sid}&page={page}"
        return _get(self.s, url, tries=3, wait=SLOW_TIMEOUT).text

    def build_index(self, kinds: list[str]) -> None:
        """Every branch's newest file from the portal's all-branches list. Each request costs about a
        minute however small it is, and the portal takes them in parallel, so this is the fast way."""
        f = CACHE / "shufersal" / "index.json"
        if f.exists() and time.time() - f.stat().st_mtime < 20 * 60:  # the signed links live about an hour
            saved = json.loads(f.read_text(encoding="utf-8"))
            if all(k in saved for k in kinds):
                self.index = saved
                return

        def first(kind):
            html = self._links(kind, 0, 1)
            return kind, html, max([int(x) for x in re.findall(r"page=(\d+)", html)] or [1])

        def page(job):
            try:
                return job[0], self._links(job[0], 0, job[1])
            except requests.RequestException:  # a missing page only means those branches ask one by one
                return job[0], ""

        with ThreadPoolExecutor(max_workers=8) as ex:
            heads = list(ex.map(first, kinds))
            pages = [(k, h) for k, h, _ in heads]
            pages += list(ex.map(page, [(k, n) for k, _, last in heads for n in range(2, last + 1)]))
        for kind, html in pages:
            table = self.index.setdefault(kind, {})
            for link in re.findall(r'href="(https://[^"]+?\.(?:gz|xml)[^"]*)"', html):
                link = link.replace("&amp;", "&")
                name = link.split("?")[0].rsplit("/", 1)[-1]
                m = re.match(r"[A-Za-z]+\d+-\d+-(\d+)-", name)
                if m and (m.group(1).zfill(3) not in table or name > table[m.group(1).zfill(3)][0]):
                    table[m.group(1).zfill(3)] = [name, link]
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(self.index), encoding="utf-8")

    def latest(self, kind: str, store: str | None = None) -> tuple[str, str]:
        if store and f"{int(store):03d}" in self.index.get(kind, {}):
            return tuple(self.index[kind][f"{int(store):03d}"])
        sid = int(store) if store else 0
        html = self._links(kind, sid, 1)
        links = re.findall(r'href="(https://[^"]+?\.(?:gz|xml)[^"]*)"', html)
        if not links:
            raise RuntimeError(f"shufersal: no {kind} file for store {store}")
        link = links[0].replace("&amp;", "&")
        name = link.split("?")[0].rsplit("/", 1)[-1]
        return name, link

    def fetch(self, name_link) -> bytes:
        return _get(self.s, name_link[1]).content


class Cerberus:
    BASE = "https://url.publishedprices.co.il"

    def __init__(self, cfg):
        self.user = cfg["user"]
        self.s = _session()
        self._files = None
        self._token = None
        self._lock = threading.Lock()

    def _login(self):
        r = _get(self.s, self.BASE + "/login")
        tok = re.search(r'name="csrftoken" content="([^"]+)"', r.text).group(1)
        r = self.s.post(self.BASE + "/login/user",
                        data={"username": self.user, "password": "", "csrftoken": tok}, timeout=60)
        m = re.search(r'name="csrftoken" content="([^"]+)"', r.text)
        if not m or "/login" in r.url:
            raise RuntimeError(f"cerberus: login failed for {self.user}")
        self._token = m.group(1)

    def refresh(self) -> None:
        self._files = None  # chains upload through the morning: a retry must see the new list

    def files(self) -> list[str]:
        with self._lock:
            if self._files is None:
                self._login()
                r = self.s.post(self.BASE + "/file/json/dir",
                                data={"sEcho": 1, "iDisplayStart": 0, "iDisplayLength": 100000,
                                      "sSearch": "", "csrftoken": self._token}, timeout=120)
                self._files = [a["fname"] for a in r.json()["aaData"]]
            return self._files

    def latest(self, kind: str, store: str | None = None) -> tuple[str, str]:
        if kind == "Stores":
            pat = re.compile(r"^Stores\d+-")
        else:
            pat = re.compile(rf"^{kind}\d+-(?:\d+-)?{int(store):03d}-")
        cand = [f for f in self.files() if pat.search(f)]
        if not cand:
            raise RuntimeError(f"cerberus/{self.user}: no {kind} file for store {store}")
        # file names end with -YYYYMMDDhhmm(ss); the newest sorts last
        cand.sort(key=lambda f: re.findall(r"\d{8,14}", f)[-1])
        name = cand[-1]
        return name, f"{self.BASE}/file/d/{name}"

    def fetch(self, name_link) -> bytes:
        return _get(self.s, name_link[1]).content


class Carrefour:
    BASE = "https://prices.carrefour.co.il"

    def __init__(self, cfg):
        self.s = _session()
        self._pages = {}

    def _day(self, d: date):
        key = d.strftime("%Y%m%d")
        if key not in self._pages:
            html = _get(self.s, f"{self.BASE}/?date={key}").text
            files = json.loads(re.search(r"const files = (\[.*?\]);", html, re.S).group(1))
            path = re.search(r"const path = '(\d+)'", html).group(1)
            branches = dict(re.findall(r'<option value="(\d{3})">\d{3} - ([^<]+)</option>', html))
            self._pages[key] = (path, [f["name"] for f in files], branches)
        return self._pages[key]

    def branches(self) -> dict:
        return self._day(date.today())[2]

    def latest(self, kind: str, store: str | None = None) -> tuple[str, str]:
        for back in range(4):
            path, names, _ = self._day(date.today() - timedelta(days=back))
            pat = re.compile(rf"^{kind}\d+-\d+-{int(store):03d}-" if store else rf"^{kind}\d+-")
            cand = sorted(n for n in names if pat.search(n))
            if cand:
                return cand[-1], f"{self.BASE}/{path}/{cand[-1]}"
        raise RuntimeError(f"carrefour: no {kind} file for store {store}")

    def fetch(self, name_link) -> bytes:
        return _get(self.s, name_link[1]).content


PORTALS = {"shufersal": Shufersal, "cerberus": Cerberus, "carrefour": Carrefour}
_open: dict[str, object] = {}


def portal(chain: str):
    if chain not in CHAINS:
        raise SystemExit(f"רשת לא מוכרת: {chain}. האפשרויות: {', '.join(CHAINS)}")
    if chain not in _open:
        cfg = CHAINS[chain]
        _open[chain] = PORTALS[cfg["kind"]](cfg)
    return _open[chain]


def _cached(chain: str, kind: str, store: str | None, max_days: int) -> Path | None:
    """Newest file already on disk for this branch, if it is recent enough."""
    pat = re.compile(rf"^{kind}\d+-" + (rf"(?:\d+-)?{int(store):03d}-" if store else ""))
    files = [f for f in (CACHE / chain).glob(f"{kind}*") if pat.search(f.name)] if (CACHE / chain).exists() else []
    if not files:
        return None
    f = max(files, key=lambda p: re.findall(r"\d{8,14}", p.name)[-1])
    stamp = re.findall(r"-(\d{8})", f.name)
    if not stamp or (date.today() - datetime.strptime(stamp[-1], "%Y%m%d").date()).days > max_days:
        return None
    return f


def download(chain: str, kind: str, store: str | None = None, stale: bool = True) -> tuple[str, bytes]:
    """Latest file of this kind, cached by its own name (names carry the timestamp).
    stale=True: if the portal fails, use a recent copy from disk (the file name in the result shows its date)."""
    p = portal(chain)
    d = CACHE / chain
    d.mkdir(parents=True, exist_ok=True)
    today = _cached(chain, kind, store, 0)
    if today:  # the full files come out once a day
        return today.name, _unpack(today.read_bytes())
    try:
        name, link = p.latest(kind, store)
        f = d / name
        if not f.exists():
            f.write_bytes(p.fetch((name, link)))
    except Exception:
        f = _cached(chain, kind, store, 14 if kind == "Stores" else 2) if stale or kind == "Stores" else None
        if not f:
            raise
    return f.name, _unpack(f.read_bytes())


def prepare(wanted: list[tuple[str, str]], say=lambda m: None) -> None:
    """Before downloading many branches: get Shufersal's all-branches list in one go."""
    ids = [s for c, s in wanted if c == "shufersal" and not _cached(c, "PriceFull", s, 0)]
    if len(ids) >= 8:
        say(f"שופרסל: מושך את רשימת הקבצים של כל הסניפים ({len(ids)} דרושים). הפורטל איטי, זה לוקח כמה דקות...")
        try:
            portal("shufersal").build_index(["PriceFull", "PromoFull"])
        except requests.RequestException:
            say("שופרסל: הרשימה המרוכזת לא ירדה, עובר סניף-סניף.")


def refresh() -> None:
    for p in _open.values():
        if hasattr(p, "refresh"):
            p.refresh()


# ---------------------------------------------------------------- XML
def _records(xml: bytes, tags: set[str]):
    """Yield {lowercased child tag: text} for every element whose tag is in `tags`."""
    parser = etree.XMLParser(recover=True, huge_tree=True)
    root = etree.fromstring(xml, parser)
    if root is None:
        return
    for el in root.iter():
        if isinstance(el.tag, str) and el.tag.lower() in tags and len(el):
            yield {c.tag.lower(): (c.text or "").strip() for c in el if isinstance(c.tag, str)}


_stores: dict[str, list[dict]] = {}


def stores(chain: str) -> list[dict]:
    if chain not in CHAINS:
        raise SystemExit(f"רשת לא מוכרת: {chain}. האפשרויות: {', '.join(CHAINS)}")
    if chain not in _stores:
        _stores[chain] = _load_stores(chain)
    return _stores[chain]


def _load_stores(chain: str) -> list[dict]:
    if CHAINS[chain]["kind"] == "carrefour":
        # Carrefour's Stores file lags; the branch dropdown is always current
        names = portal(chain).branches()
        out = []
        try:
            _, xml = download(chain, "Stores")
            for r in _records(xml, {"store", "branch"}):
                out.append(_store_row(r))
        except Exception:
            pass
        have = {s["id"] for s in out}
        for sid, nm in names.items():
            if sid not in have:
                out.append({"id": sid, "name": nm.strip(), "city": "", "address": ""})
        return out
    _, xml = download(chain, "Stores")
    return [_store_row(r) for r in _records(xml, {"store", "branch"})]


def _store_row(r: dict) -> dict:
    return {
        "id": f'{int(r.get("storeid") or r.get("storeid", "0") or 0):03d}',
        "name": r.get("storename", ""),
        "city": r.get("city", ""),
        "address": r.get("address", ""),
    }


def _num(x: str) -> float | None:
    try:
        return float(x.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def price_full(chain: str, store: str, stale: bool = True) -> dict:
    """barcode → {name, price, manufacturer, qty, unit, weighted}."""
    name, xml = download(chain, "PriceFull", store, stale)
    out = {}
    for r in _records(xml, {"item", "product"}):
        code = (r.get("itemcode") or "").lstrip("0")
        price = _num(r.get("itemprice", ""))
        if not code or price is None or price <= 0:
            continue
        out[code] = {
            "name": r.get("itemname") or r.get("manufactureritemdescription", ""),
            "price": price,
            "manufacturer": r.get("manufacturername", ""),
            "qty": r.get("quantity", ""),
            "unit": r.get("unitqty", ""),
            "weighted": r.get("bisweighted", "0") == "1" or r.get("itemtype") == "0",
            "unit_price": _num(r.get("unitofmeasureprice", "")),
        }
    return {"file": name, "items": out}


def _when(x: str):
    x = (x or "").strip().replace("T", " ")
    for f in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(x, f)
        except ValueError:
            pass
    return None


def promos(chain: str, store: str, stale: bool = True) -> dict:
    """Active promotions of a branch: {"file", "by_item": {barcode: [id...]}, "promos": {id: promo}}.

    A promo says: MinQty units (any mix of its items) cost `price` together. Only simple price deals
    are kept. Gifts, percent-off-the-basket, coupons and minimum-spend deals are left out on purpose,
    so we never claim a discount the shopper would not actually get. club=True needs a membership.
    """
    name, xml = download(chain, "PromoFull", store, stale)
    root = etree.fromstring(xml, etree.XMLParser(recover=True, huge_tree=True))
    now, out, by_item = datetime.now(), {}, {}
    for el in root.iter():
        if not (isinstance(el.tag, str) and el.tag.lower() == "promotion"):
            continue
        h = {k.tag.lower(): (k.text or "").strip() for k in el.iter() if isinstance(k.tag, str) and len(k) == 0}
        start, end = _when(h.get("promotionstartdatetime") or h.get("promotionstartdate")), \
            _when(h.get("promotionenddatetime") or h.get("promotionenddate"))
        if not start or not end or not (start <= now <= end):
            continue
        desc, club_id = h.get("promotiondescription", ""), h.get("clubid", "")
        if h.get("additionaliscoupon", "0") not in ("0", "") or "קופון" in desc:
            continue
        if h.get("additionalrestrictions") or (_num(h.get("minpurchaseamount", "") or "0") or 0) > 0:
            continue
        items = [{k.tag.lower(): (k.text or "").strip() for k in it if isinstance(k.tag, str)}
                 for it in el.iter() if isinstance(it.tag, str) and it.tag.lower() in ("promotionitem", "item")
                 and any(isinstance(k.tag, str) and k.tag.lower() == "itemcode" for k in it)]
        items = [i for i in items if i.get("rewardtype") in ("1", "3", "10") and i.get("biswighted") != "1"
                 and i.get("bisweighted", "0") != "1"]
        if not items:
            continue
        price, mn = _num(items[0].get("discountedprice", "")), _num(items[0].get("minqty", "") or "1") or 1
        if not price or price <= 0 or mn <= 0 or mn != int(mn):
            continue
        pid = h.get("promotionid") or desc
        out[pid] = {"id": pid, "desc": desc, "min": int(mn), "price": price, "end": end.strftime("%d.%m"),
                    "limit": int(_num(h.get("redemptionlimit", "") or "0") or 0),
                    "club": not (re.match(r"^0(\b|\s|$)", club_id) and "מועדון" not in club_id + desc)}
        for i in items:
            by_item.setdefault(i.get("itemcode", "").lstrip("0"), []).append(pid)
    return {"file": name, "by_item": by_item, "promos": out}


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Hebrew on Windows consoles
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("stores"); a.add_argument("chain"); a.add_argument("--city")
    b = sub.add_parser("prices"); b.add_argument("chain"); b.add_argument("store")
    args = ap.parse_args()
    if args.cmd == "stores":
        import geo
        for s in stores(args.chain):
            city = geo.city_name(s["city"])
            hay = " ".join([city, s["name"], s["address"]]).replace('ת"א', "תל אביב").replace("ת״א", "תל אביב").replace('ר"ג', "רמת גן")
            if not args.city or args.city in hay:
                print(s["id"], "|", s["name"], "|", city, "|", s["address"])
    else:
        pf = price_full(args.chain, args.store)
        print(pf["file"], len(pf["items"]), "items")
        for k, v in list(pf["items"].items())[:5]:
            print(k, v["name"], v["price"])


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException:
        raise SystemExit("הפורטל של הרשת לא עונה כרגע. פורטל שופרסל מפסיק לענות לפעמים לכמה דקות. נסו שוב בעוד 5-10 דקות.")
