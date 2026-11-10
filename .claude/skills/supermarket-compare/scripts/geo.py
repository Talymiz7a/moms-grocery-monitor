#!/usr/bin/env python3
"""Where the branches are, and the streets around them (OpenStreetMap, free, no key).

    geocode("מבצע קדש 68", "בני ברק")   -> (lat, lon) | None   (Nominatim, cached, 1 req/sec)
    city_center("רמת גן")                -> (lat, lon) | None   (city_centers.json first, then Nominatim)
    brand_pois(center, km, aliases)      -> {chain: [(lat, lon)...]} real shops on the map, to verify branches
    basemap(bbox)                        -> {"roads": [{"r": rank, "p": [[lat, lon]...]}...]}

Branch files list the city as a number (the CBS locality code), so CITY_CODES maps it to a name.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
from pathlib import Path

import requests

UA = "supermarket-compare/1.0 (personal price comparison)"
CACHE = Path(os.environ.get("SUPERMARKET_CACHE", Path.home() / ".supermarket-compare" / "cache"))
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter")

# CBS locality codes as they appear in the chains' Stores files (official list, data.gov.il)
CITY_CODES = {k: v.replace("תל אביב - יפו", "תל אביב") for k, v in
              json.loads(Path(__file__).with_name("city_codes.json").read_text(encoding="utf-8")).items()}
_CENTERS_FILE = Path(__file__).with_name("city_centers.json")
_last = [0.0]


def city_name(code_or_name: str) -> str:
    c = str(code_or_name).strip()
    return CITY_CODES.get(c.lstrip("0"), c)


def km(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = (math.sin((la2 - la1) * p / 2) ** 2
         + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def _cache(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / name


def _nominatim(params: dict) -> list:
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    r = requests.get("https://nominatim.openstreetmap.org/search",
                     params={**params, "format": "json", "limit": 1, "countrycodes": "il", "addressdetails": 1},
                     headers={"User-Agent": UA, "Accept-Language": "he"}, timeout=30)
    return r.json() if r.ok else []


def _photon(q: str, city: str, box=None) -> dict | None:
    """Second opinion when Nominatim can't read a Hebrew address. Same shape as a Nominatim hit."""
    params = {"q": q, "limit": 1, "lang": "default"}
    if box:
        params.update(lat=box[0], lon=box[1])
    try:
        r = requests.get("https://photon.komoot.io/api/", params=params, headers={"User-Agent": UA}, timeout=20)
        feats = r.json().get("features", []) if r.ok else []
    except (requests.RequestException, ValueError):
        return None
    if not feats or feats[0].get("properties", {}).get("countrycode") != "IL":
        return None
    prop, (lon, lat) = feats[0]["properties"], feats[0]["geometry"]["coordinates"]
    return {"lat": lat, "lon": lon, "address": {k: prop.get(k, "") for k in ("city", "town", "district", "county")}}


def _norm_city(s: str) -> str:
    s = re.sub(r"[-־–'\"״׳]", " ", s or "").replace("קריית", "קרית")
    return re.sub(r"\s+", " ", s).strip()


def _in_city(hit: dict, city: str) -> bool:
    """Free text answers with the same street in the next town; this rejects that."""
    a, want = hit.get("address", {}), _norm_city(city)
    names = [_norm_city(a.get(k, "")) for k in ("city", "town", "village", "municipality", "suburb", "county")]
    return any(n and (want in n or n in want) for n in names)


def geocode(address: str, city: str, city_fallback: bool = True, box=None) -> tuple[float, float] | None:
    """Street → (lat, lon). Structured street + city first, then free text that must land in that city.
    box = (lat, lon, km) limits the search to an area; used for shops whose file has no city."""
    f = _cache("geocode.json")
    db = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    key = f"v4|{address}|{city}|{int(city_fallback)}|{box and tuple(round(x, 2) for x in box)}"
    if key in db:
        return tuple(db[key]) if db[key] else None
    real_city = city and city != "ישראל"
    extra = {}
    if box:
        la, lo, r = box
        dla, dlo = r / 110.5, r / (111.3 * math.cos(math.radians(la)))
        extra = {"viewbox": f"{lo - dlo},{la + dla},{lo + dlo},{la - dla}", "bounded": 1}
    out = None
    if real_city and address and address != city:
        hits = _nominatim({"street": address, "city": city, **extra})
        if hits and _in_city(hits[0], city):
            out = hits[0]
    if out is None:
        hits = _nominatim({"q": ", ".join(p for p in dict.fromkeys([address, city, "ישראל"]) if p), **extra})
        if hits and (not real_city or _in_city(hits[0], city)):
            out = hits[0]
    if out is None and real_city and address and address != city:  # no city to check it against = no answer we can trust
        hit = _photon(", ".join(p for p in dict.fromkeys([address, city]) if p), city, box)
        if hit and (not real_city or _in_city(hit, city)):
            out = hit
    if out is None and city_fallback and real_city:
        hits = _nominatim({"city": city})
        out = hits[0] if hits else None
    res = (float(out["lat"]), float(out["lon"])) if out else None
    db[key] = res
    f.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def reverse(ll) -> str | None:
    """(lat, lon) → "רחוב ומספר, עיר", for a branch whose chain published no address. Cached, 1 req/sec."""
    f = _cache("geocode.json")
    db = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    key = f"rev|{round(ll[0], 5)}|{round(ll[1], 5)}"
    if key in db:
        return db[key]
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        r = requests.get("https://nominatim.openstreetmap.org/reverse", params={"lat": ll[0], "lon": ll[1], "format": "json", "zoom": 18, "addressdetails": 1},
                         headers={"User-Agent": UA, "Accept-Language": "he"}, timeout=30)
        a = r.json().get("address", {}) if r.ok else {}
    except (requests.RequestException, ValueError):
        return None
    city = a.get("city") or a.get("town") or a.get("village") or ""
    text = ", ".join(p for p in (" ".join(x for x in (a.get("road", ""), a.get("house_number", "")) if x), city) if p) if a.get("road") else None
    db[key] = text
    f.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")
    return text


def city_center(city: str) -> tuple[float, float] | None:
    known = json.loads(_CENTERS_FILE.read_text(encoding="utf-8")) if _CENTERS_FILE.exists() else {}
    if city in known:
        return tuple(known[city]) if known[city] else None
    return geocode(city, "ישראל", city_fallback=False)


def _overpass(query: str, timeout: int = 150) -> list:
    errs = []
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": query}, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=timeout)
            r.raise_for_status()
            return r.json()["elements"]
        except Exception as err:
            errs.append(f"{url.split('/')[2]}: {str(err)[:80]}")
    raise RuntimeError("overpass: download failed: " + " | ".join(errs))


def brand_pois(center, radius_km: float, aliases: dict) -> dict:
    """Supermarkets actually mapped around a point, by chain. If the map is unavailable, returns {}."""
    la, lo = center
    f = _cache(f"pois_{round(la, 3)}_{round(lo, 3)}_{round(radius_km, 1)}.json")
    if f.exists():
        els = json.loads(f.read_text(encoding="utf-8"))
    else:
        try:
            els = _overpass(f'[out:json][timeout:30];nwr["shop"="supermarket"](around:{int(radius_km * 1000)},{la},{lo});out center tags;', timeout=35)
        except RuntimeError:
            return {}
        f.write_text(json.dumps(els, ensure_ascii=False), encoding="utf-8")
    out = {c: [] for c in aliases}
    for e in els:
        t, c = e.get("tags", {}), e.get("center", e)
        hay = " ".join(t.get(k, "") for k in ("name", "name:he", "name:en", "brand", "brand:he", "operator")).lower()
        for chain, names in aliases.items():
            if any(n in hay for n in names):
                out[chain].append((c["lat"], c["lon"]))
    return out


ROAD_RANK = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 1, "tertiary": 2,
             "residential": 3, "unclassified": 3, "living_street": 3, "rail": 4}


def basemap(bbox: tuple[float, float, float, float]) -> dict:
    """bbox = (south, west, north, east). Roads as polylines, rank 0 (highway) … 4 (rail)."""
    s, w, n, e = (round(v, 4) for v in bbox)
    f = _cache(f"basemap_{s}_{w}_{n}_{e}.json")
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    els = _overpass(f"""[out:json][timeout:120];
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({s},{w},{n},{e});
 way["railway"="rail"]({s},{w},{n},{e}););
out geom;""")
    roads = []
    for el in els:
        t = el.get("tags", {})
        kind = "rail" if t.get("railway") == "rail" else t.get("highway", "")
        kind = kind.replace("_link", "")
        rank = ROAD_RANK.get(kind)
        if rank is None or "geometry" not in el:
            continue
        roads.append({"r": rank, "p": [[round(p["lat"], 5), round(p["lon"], 5)] for p in el["geometry"]]})
    out = {"bbox": [s, w, n, e], "roads": roads}
    f.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return out
