#!/usr/bin/env python3
"""Turn result.json into the animated screen (studio/index.html + data.js + map).

    python build_studio.py --result result.json --photo receipt.jpg --out RUN/studio [--open]

The map is real OpenStreetMap streets around the branches, projected once here so the browser
only draws pre-made polylines into a cached layer.
"""
from __future__ import annotations

import argparse
import json
import sys
import math
import shutil
import webbrowser
from pathlib import Path

import geo

HERE = Path(__file__).resolve().parent
STUDIO_SRC = HERE.parent / "studio"
W, H = 1920, 1080
PIN_RECT = (380, 350, 1210, 860)       # where the branches must land (left of the receipt, under the counter)
MIN_SPAN_M = 1600


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1e-9
    imax, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
        if d > dmax:
            imax, dmax = i, d
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[: imax + 1], eps)[:-1] + rdp(pts[imax:], eps)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Hebrew on Windows consoles
    ap = argparse.ArgumentParser()
    ap.add_argument("--result", required=True)
    ap.add_argument("--photo", help="the receipt photo, shown being scanned at the start")
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-year", type=int, default=12, help="how many such shops a year (12 = monthly, 52 = weekly)")
    ap.add_argument("--open", action="store_true")
    a = ap.parse_args()

    res = json.loads(Path(a.result).read_text(encoding="utf-8"))
    all_stores = [s for s in res["stores"] if s.get("ll")]
    # on screen: the receipt's branch + the cheapest branch of every chain inside the radius
    top = {}
    for s in sorted((x for x in all_stores if x["key"] != res["home"]), key=lambda x: x["total"]):
        top.setdefault(s["chain"], s)
    stores = [s for s in all_stores if s["key"] == res["home"]] + sorted(top.values(), key=lambda x: x["total"])
    if len(stores) < 2:
        raise SystemExit("צריך מיקום לפחות לשני סניפים")
    lat0 = sum(s["ll"][0] for s in stores) / len(stores)
    lon0 = sum(s["ll"][1] for s in stores) / len(stores)
    kx, ky = math.cos(math.radians(lat0)) * 111320, 110540

    def m(lat, lon):
        return (lon - lon0) * kx, (lat - lat0) * ky

    ms = [m(*s["ll"]) for s in stores]
    minx, maxx = min(p[0] for p in ms), max(p[0] for p in ms)
    miny, maxy = min(p[1] for p in ms), max(p[1] for p in ms)
    spanx, spany = max(maxx - minx, MIN_SPAN_M), max(maxy - miny, MIN_SPAN_M)
    rx0, ry0, rx1, ry1 = PIN_RECT
    sc = min((rx1 - rx0) / spanx, (ry1 - ry0) / spany)
    cx_m, cy_m = (minx + maxx) / 2, (miny + maxy) / 2
    cx_px, cy_px = (rx0 + rx1) / 2, (ry0 + ry1) / 2

    def px(lat, lon):
        x, y = m(lat, lon)
        return round(cx_px + (x - cx_m) * sc, 1), round(cy_px - (y - cy_m) * sc, 1)

    def inv(x, y):
        mx, my = (x - cx_px) / sc + cx_m, -(y - cy_px) / sc + cy_m
        return lat0 + my / ky, lon0 + mx / kx

    s_lat, w_lon = inv(-60, H + 60)
    n_lat, e_lon = inv(W + 60, -60)
    bm = geo.basemap((s_lat, w_lon, n_lat, e_lon))
    layers = [[] for _ in range(5)]
    n_pts = 0
    for road in bm["roads"]:
        pts = [px(la, lo) for la, lo in road["p"]]
        if all(x < -40 or x > W + 40 or y < -40 or y > H + 40 for x, y in pts):
            continue
        pts = rdp(pts, 0.35)
        flat = [v for p in pts for v in p]
        n_pts += len(pts)
        layers[road["r"]].append(flat)

    keys = [s["key"] for s in stores]
    best_i = keys.index(res["best"])
    home_i = keys.index(res["home"])
    items = []
    for ln in res["lines"]:
        if "amounts" not in ln or not all(k in ln["amounts"] for k in keys):
            continue
        am = [ln["paid"] if k == res["home"] else ln["amounts"][k] for k in keys]
        lo = min(am)
        cheapest = best_i if am[best_i] == lo else am.index(lo)
        items.append({"name": ln["name"], "qty": ln["qty"], "paid": ln["paid"], "a": am, "c": cheapest})

    data = {
        "W": W, "H": H,
        "receipt": res["receipt"],
        "stores": [{"he": s["he"], "branch": s["branch"], "color": s["color"], "total": s["total"],
                    "xy": px(*s["ll"])} for s in stores],
        "home": home_i, "best": best_i,
        "saving": res["saving"], "paid": res["paid_common"],
        "km": res.get("km_to_best"), "perYear": a.per_year,
        "radius": res.get("radius_km"), "branches": len(res["stores"]) - 1,
        "items": items,
        "roads": layers,
        "pxPerKm": round(sc * 1000, 2),
        "photo": "receipt.jpg" if a.photo else None,
        "advice": {k: res["advice"]["recommended"].get(k) for k in ("name", "address", "address_source", "waze", "google", "km", "saving", "net", "trip_cost")} | {"go": res["advice"]["go"]} if res.get("advice") else None,
        "disclaimer": res.get("disclaimer"),
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "data.js").write_text("window.DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";",
                                 encoding="utf-8")
    for f in STUDIO_SRC.iterdir():
        if f.is_file():
            shutil.copy2(f, out / ("index.html" if f.name == "studio.html" else f.name))
    if a.photo:
        from PIL import Image
        im = Image.open(a.photo).convert("RGB")
        im.thumbnail((900, 1300))
        im.save(out / "receipt.jpg", quality=86)
    print(f"{out/'index.html'}  ({len(items)} פריטים, {sum(len(l) for l in layers)} רחובות, {n_pts} נקודות)")
    if a.open:
        webbrowser.open((out / "index.html").resolve().as_uri())


if __name__ == "__main__":
    main()
