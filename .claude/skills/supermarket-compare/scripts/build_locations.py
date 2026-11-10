#!/usr/bin/env python3
"""Pre-compute where every branch in the country is, so nobody has to wait for geocoding.

    python build_locations.py     → branch_locations.json (ships with the skill; ~20 minutes, polite to OSM)

Each branch: street geocode → "address", confirmed against shops mapped on OpenStreetMap → "verified".
Shops whose file has no city or address are searched on the map by chain + branch name.
"""
from __future__ import annotations

import json
from pathlib import Path

import chains
import compare
import geo

OUT = Path(__file__).with_name("branch_locations.json")
ISRAEL = (31.7, 35.0, 230)


def country_pois() -> dict:
    els = geo._overpass('[out:json][timeout:120];area["ISO3166-1"="IL"][admin_level=2]->.a;nwr["shop"="supermarket"](area.a);out center tags;')
    out = {c: [] for c in chains.CHAINS}
    for e in els:
        t, c = e.get("tags", {}), e.get("center", e)
        hay = " ".join(t.get(k, "") for k in ("name", "name:he", "name:en", "brand", "brand:he", "operator")).lower()
        for chain, cfg in chains.CHAINS.items():
            if any(n in hay for n in cfg["osm"]):
                out[chain].append((c["lat"], c["lon"]))
    return out


def main():
    pois = country_pois()
    print({c: len(v) for c, v in pois.items()})
    table = {}
    for chain in chains.CHAINS:
        for s in chains.stores(chain):
            if compare.SKIP_BRANCH.search(s.get("name", "")) or s.get("address", "").startswith("http"):
                continue
            ll = compare.locate(chain, s, ISRAEL)
            if not ll:
                continue
            ll, how = compare.verify(chain, ll, pois)
            table[f'{chain}:{s["id"]}'] = [round(ll[0], 5), round(ll[1], 5), how]
        OUT.write_text(json.dumps(table, ensure_ascii=False, indent=0), encoding="utf-8")
        print(chain, len(table), flush=True)


if __name__ == "__main__":
    main()
