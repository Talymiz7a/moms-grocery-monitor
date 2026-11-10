#!/usr/bin/env python3
"""Optional: read a supermarket receipt photo with an OpenAI vision model → structured JSON.
Not needed in normal use, Claude reads the photo itself (see SKILL.md).

    python read_receipt.py receipt.jpg --out receipt.json

Key: OPENAI_API_KEY from the environment or ~/.supermarket-compare/.env.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path

HOME = Path(os.environ.get("SUPERMARKET_HOME", Path.home() / ".supermarket-compare"))
MODEL = os.environ.get("RECEIPT_MODEL", "gpt-5.5")

PROMPT = """זו תמונה של קבלה מסופרמרקט בישראל. החזר JSON בלבד, במבנה:
{"chain": "שם הרשת כפי שמודפס", "branch": "שם/כתובת הסניף כפי שמודפס", "date": "YYYY-MM-DD או null",
 "lines": [{"name": "שם הפריט בדיוק כפי שמודפס", "barcode": "ברקוד אם מודפס ליד הפריט, אחרת null",
            "qty": מספר, "unit_price": מחיר ליחידה, "total": סה"כ לשורה, "weighted": true אם נמכר במשקל}],
 "total": סה"כ לתשלום}
כללים: שורה לכל פריט שנקנה. כמות ומחיר ליחידה נלקחים משורת "2 X 7.35" שמתחת לפריט; אם אין, qty=1.
הנחות, מבצעים ופיקדון: שורה עם total שלילי ושם ההנחה, ו-"discount": true. אל תמציא פריטים שלא מופיעים."""


def _load_env():
    for f in (HOME / ".env", Path.cwd() / ".env"):
        if f.exists():
            for line in f.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def read(image: str, model: str = MODEL) -> dict:
    _load_env()
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("חסר OPENAI_API_KEY (בקובץ ~/.supermarket-compare/.env)")
    from openai import OpenAI
    mime = mimetypes.guess_type(image)[0] or "image/jpeg"
    data = f"data:{mime};base64," + base64.b64encode(Path(image).read_bytes()).decode()
    resp = OpenAI().responses.create(
        model=model,
        input=[{"role": "user", "content": [{"type": "input_text", "text": PROMPT},
                                             {"type": "input_image", "image_url": data}]}],
        text={"format": {"type": "json_object"}},
    )
    return json.loads(resp.output_text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=MODEL)
    a = ap.parse_args()
    r = read(a.image, a.model)
    Path(a.out).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = [l for l in r.get("lines", []) if not l.get("discount")]
    s = sum(float(l.get("total") or 0) for l in r.get("lines", []))
    print(f'{r.get("chain")} | {r.get("branch")} | {len(lines)} פריטים | סכום שורות {s:.2f} | סה"כ בקבלה {r.get("total")}')


if __name__ == "__main__":
    main()
