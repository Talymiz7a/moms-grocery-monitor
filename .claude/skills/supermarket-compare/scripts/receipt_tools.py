#!/usr/bin/env python3
"""Helpers for reading a receipt photo inside Claude Code, with no API key.

    python receipt_tools.py split photo.jpg --out RUN/parts   → overlapping crops, sharp enough to read
    python receipt_tools.py check RUN/receipt.json            → do the lines add up to the printed total?
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps


def split(photo: str, out: str, part: int = 1100, overlap: int = 90) -> list[Path]:
    im = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    if im.width > 1000:  # enough for small print, without wasting pixels
        im = im.resize((1000, round(im.height * 1000 / im.width)))
    d = Path(out)
    d.mkdir(parents=True, exist_ok=True)
    files, y, i = [], 0, 1
    while True:
        p = d / f"part-{i:02d}.jpg"
        im.crop((0, y, im.width, min(y + part, im.height))).save(p, quality=92)
        files.append(p)
        if y + part >= im.height:
            return files
        y += part - overlap
        i += 1


def check(path: str) -> bool:
    r = json.loads(Path(path).read_text(encoding="utf-8"))
    lines = r.get("lines", [])
    items = [l for l in lines if not l.get("discount") and float(l.get("total") or 0) > 0]
    s, t = sum(float(l.get("total") or 0) for l in lines), float(r.get("total") or 0)
    bad = [l["name"] for l in items if abs(float(l.get("qty") or 1) * float(l.get("unit_price") or l["total"]) - float(l["total"])) > 0.02]
    print(f'{r.get("chain")} | {r.get("branch")} | {len(items)} פריטים | סכום השורות {s:.2f} | סה"כ בקבלה {t:.2f}')
    if bad:
        print("כמות כפול מחיר לא יוצא הסכום בשורות:", ", ".join(bad))
    ok = abs(s - t) < 0.02 and not bad
    print("תקין" if ok else "לא תקין: משהו לא נקרא נכון. בדוק שוב את השורות מול הצילום.")
    return ok


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Hebrew on Windows consoles
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("split"); a.add_argument("photo"); a.add_argument("--out", required=True)
    b = sub.add_parser("check"); b.add_argument("receipt")
    x = ap.parse_args()
    if x.cmd == "split":
        for f in split(x.photo, x.out):
            print(f)
    else:
        raise SystemExit(0 if check(x.receipt) else 1)


if __name__ == "__main__":
    main()
