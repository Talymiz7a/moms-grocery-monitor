// Fictional demo data: five months (01/06/2026 – 28/10/2026) of grocery
// receipts with realistic Hebrew product wording.
//
// Generation is deterministic (seeded PRNG) so every reset produces the same
// data and tests can rely on it. The data deliberately contains the
// situations the app must handle: normal recurring purchases, quantity
// spikes, short-interval repeats, new and unexpected products, duplicate
// receipts, inconsistent product names, low-confidence OCR, discounts,
// returns, an incomplete receipt, a missing date and a total mismatch.

import { addDays } from "./dates";

export type Unit = "unit" | "kg" | "g" | "l" | "ml" | "pack";
export type ExpectedUse = "expected" | "occasional" | "not_expected" | "manual_review";
export type LineType = "item" | "discount" | "return" | "deposit";
export type Confidence = "high" | "medium" | "low";

export type DemoProduct = {
  key: string;
  canonicalName: string;
  aliases: string[];
  category: string;
  unit: Unit;
  packageSize?: number;
  packageUnit?: Unit;
  expectedUse: ExpectedUse;
  priceAgorot: number;
};

export type DemoLine = {
  description: string;
  productKey?: string;
  matchStatus: "confirmed" | "unmatched";
  lineType: LineType;
  quantity: number;
  unit: Unit;
  unitPriceAgorot?: number;
  lineTotalAgorot: number;
  discountAgorot?: number;
  confidence: Confidence;
  lowConfidenceFields: string[];
};

export type DemoStore = { name: string; address: string; prefix: string };

export type DemoReceipt = {
  key: string;
  store: DemoStore;
  purchaseDate?: string;
  time: string;
  receiptNumber?: string;
  totalAgorot?: number;
  lines: DemoLine[];
  verificationStatus: "draft" | "verified";
  ocrConfidence: Confidence;
  shopper?: string;
  notes?: string;
  /** Visual style of the generated receipt image. */
  imageStyle: "clear" | "blurry" | "torn";
  /** This receipt reuses the exact same image file as another receipt. */
  sameFileAs?: string;
  duplicateOfKey?: string;
  duplicateReason?: string;
};

export const DEMO_START = "2026-06-01";
export const DEMO_END = "2026-10-28";

export const STORES: Record<"main" | "small" | "market", DemoStore> = {
  main: { name: "סופר השכונה", address: "רח' הדקל 12, עיר לדוגמה", prefix: "41" },
  small: { name: "מרכול הדר", address: "שד' הגפן 5, עיר לדוגמה", prefix: "77" },
  market: { name: "ירקות השוק של אבי", address: "שוק העירוני, דוכן 8", prefix: "09" },
};

export const PRODUCTS: DemoProduct[] = [
  { key: "milk3", canonicalName: "חלב 3% 1 ליטר", aliases: ["חלב 3% 1 ליטר", "חלב טרי 3% 1ל", "חלב 3 אחוז קרטון 1 ליטר"], category: "מוצרי חלב", unit: "unit", packageSize: 1, packageUnit: "l", expectedUse: "expected", priceAgorot: 690 },
  { key: "milk1", canonicalName: "חלב 1% 1 ליטר", aliases: ["חלב 1% 1 ליטר", "חלב דל שומן 1% 1ל"], category: "מוצרי חלב", unit: "unit", packageSize: 1, packageUnit: "l", expectedUse: "occasional", priceAgorot: 690 },
  { key: "bread", canonicalName: "לחם אחיד פרוס 750 גרם", aliases: ["לחם אחיד פרוס 750 גרם", "לחם אחיד פרוס", "לחם אחיד 750 גר"], category: "מאפים", unit: "unit", packageSize: 750, packageUnit: "g", expectedUse: "expected", priceAgorot: 850 },
  { key: "breadWhole", canonicalName: "לחם מלא 500 גרם", aliases: ["לחם מלא 500 גרם", "לחם מלא פרוס 500ג"], category: "מאפים", unit: "unit", packageSize: 500, packageUnit: "g", expectedUse: "expected", priceAgorot: 1490 },
  { key: "eggs", canonicalName: "ביצים L תבנית 12", aliases: ["ביצים L תבנית 12", "ביצים L 12 יח", "ביצים גדולות 12 יח'"], category: "ביצים", unit: "pack", packageSize: 12, packageUnit: "unit", expectedUse: "expected", priceAgorot: 1390 },
  { key: "whiteCheese", canonicalName: "גבינה לבנה 5% 250 גרם", aliases: ["גבינה לבנה 5% 250 גרם", "גב. לבנה 5% 250ג"], category: "מוצרי חלב", unit: "unit", packageSize: 250, packageUnit: "g", expectedUse: "expected", priceAgorot: 590 },
  { key: "cottage", canonicalName: "קוטג' 5% 250 גרם", aliases: ["קוטג' 5% 250 גרם", "קוטג 5% 250 גר"], category: "מוצרי חלב", unit: "unit", packageSize: 250, packageUnit: "g", expectedUse: "expected", priceAgorot: 590 },
  { key: "yogurt", canonicalName: "יוגורט טבעי 3% 200 גרם", aliases: ["יוגורט טבעי 3% 200 גרם", "יוגורט 3% 200ג"], category: "מוצרי חלב", unit: "unit", packageSize: 200, packageUnit: "g", expectedUse: "expected", priceAgorot: 390 },
  { key: "tomato", canonicalName: "עגבניות", aliases: ["עגבניות", "עגבניה שרי/רגילה"], category: "ירקות ופירות", unit: "kg", expectedUse: "expected", priceAgorot: 790 },
  { key: "cucumber", canonicalName: "מלפפונים", aliases: ["מלפפונים", "מלפפון"], category: "ירקות ופירות", unit: "kg", expectedUse: "expected", priceAgorot: 690 },
  { key: "banana", canonicalName: "בננות", aliases: ["בננות", "בננה"], category: "ירקות ופירות", unit: "kg", expectedUse: "expected", priceAgorot: 890 },
  { key: "apple", canonicalName: "תפוחי עץ", aliases: ["תפוחי עץ", "תפוח עץ גאלה"], category: "ירקות ופירות", unit: "kg", expectedUse: "expected", priceAgorot: 1190 },
  { key: "coffee", canonicalName: "קפה נמס 200 גרם", aliases: ["קפה נמס 200 גרם", "קפה נמס מגורען 200ג"], category: "שתייה חמה", unit: "unit", packageSize: 200, packageUnit: "g", expectedUse: "expected", priceAgorot: 3290 },
  { key: "tea", canonicalName: "תה 25 שקיקים", aliases: ["תה 25 שקיקים", "תה שקיקים 25 יח"], category: "שתייה חמה", unit: "unit", packageSize: 25, packageUnit: "unit", expectedUse: "occasional", priceAgorot: 1290 },
  { key: "oil", canonicalName: "שמן קנולה 1 ליטר", aliases: ["שמן קנולה 1 ליטר"], category: "מזווה", unit: "unit", packageSize: 1, packageUnit: "l", expectedUse: "occasional", priceAgorot: 1290 },
  { key: "sugar", canonicalName: "סוכר לבן 1 ק\"ג", aliases: ["סוכר לבן 1 ק\"ג", "סוכר 1 קג"], category: "מזווה", unit: "unit", packageSize: 1, packageUnit: "kg", expectedUse: "occasional", priceAgorot: 590 },
  { key: "rice", canonicalName: "אורז פרסי 1 ק\"ג", aliases: ["אורז פרסי 1 ק\"ג"], category: "מזווה", unit: "unit", packageSize: 1, packageUnit: "kg", expectedUse: "occasional", priceAgorot: 1190 },
  { key: "chicken", canonicalName: "חזה עוף טרי", aliases: ["חזה עוף טרי", "חזה עוף טרי לק\"ג"], category: "בשר ועוף", unit: "kg", expectedUse: "expected", priceAgorot: 3990 },
  { key: "water", canonicalName: "מים מינרליים 6×1.5 ליטר", aliases: ["מים מינרליים 6×1.5 ליטר", "מים מינרלים שישיה 1.5ל"], category: "שתייה", unit: "pack", packageSize: 6, packageUnit: "unit", expectedUse: "expected", priceAgorot: 1690 },
  { key: "toilet", canonicalName: "נייר טואלט 32 גלילים", aliases: ["נייר טואלט 32 גלילים", "נ. טואלט 32 גליל"], category: "ניקיון ובית", unit: "pack", packageSize: 32, packageUnit: "unit", expectedUse: "expected", priceAgorot: 4490 },
  { key: "hummus", canonicalName: "חומוס 400 גרם", aliases: ["חומוס 400 גרם", "סלט חומוס 400ג"], category: "סלטים", unit: "unit", packageSize: 400, packageUnit: "g", expectedUse: "occasional", priceAgorot: 890 },
  { key: "energy", canonicalName: "משקה אנרגיה 250 מ\"ל", aliases: ["משקה אנרגיה 250 מ\"ל", "משקה אנרגיה פחית 250"], category: "שתייה", unit: "unit", packageSize: 250, packageUnit: "ml", expectedUse: "not_expected", priceAgorot: 790 },
  { key: "dogFood", canonicalName: "מזון יבש לכלבים 3 ק\"ג", aliases: ["מזון יבש לכלבים 3 ק\"ג"], category: "חיות מחמד", unit: "unit", packageSize: 3, packageUnit: "kg", expectedUse: "not_expected", priceAgorot: 6990 },
];

const productByKey = new Map(PRODUCTS.map((p) => [p.key, p]));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Trip = "main" | "small" | "market";

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
}

export function generateDemoData(): { products: DemoProduct[]; receipts: DemoReceipt[] } {
  const rand = mulberry32(20260601);
  const lastBought = new Map<string, string>();
  const receiptCounters: Record<Trip, number> = { main: 18230, small: 5520, market: 310 };
  const receipts: DemoReceipt[] = [];

  function line(key: string, quantity: number, opts: Partial<DemoLine> & { aliasIndex?: number } = {}): DemoLine {
    const p = productByKey.get(key)!;
    const description = opts.description ?? p.aliases[opts.aliasIndex ?? Math.floor(rand() * p.aliases.length)];
    const qty = p.unit === "kg" ? Math.round(quantity * 1000) / 1000 : quantity;
    return {
      description,
      productKey: key,
      matchStatus: "confirmed",
      lineType: "item",
      quantity: qty,
      unit: p.unit,
      unitPriceAgorot: p.priceAgorot,
      lineTotalAgorot: Math.round(p.priceAgorot * qty),
      confidence: "high",
      lowConfidenceFields: [],
      ...opts,
    };
  }

  function daysSince(key: string, date: string): number {
    const last = lastBought.get(key);
    if (!last) return 999;
    return Math.round((Date.parse(date) - Date.parse(last)) / 86_400_000);
  }

  function addReceipt(trip: Trip, date: string, lines: DemoLine[], extra: Partial<DemoReceipt> = {}): DemoReceipt {
    for (const l of lines) if (l.productKey && l.lineType === "item") lastBought.set(l.productKey, date);
    receiptCounters[trip] += 1 + Math.floor(rand() * 40);
    const store = STORES[trip];
    const total = lines.reduce((s, l) => s + l.lineTotalAgorot - (l.discountAgorot ?? 0), 0);
    const hour = trip === "main" ? 9 + Math.floor(rand() * 3) : 16 + Math.floor(rand() * 3);
    const r: DemoReceipt = {
      key: `${date}-${trip}-${receipts.length}`,
      store,
      purchaseDate: date,
      time: `${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`,
      receiptNumber: `${store.prefix}-${receiptCounters[trip]}`,
      totalAgorot: total,
      lines,
      verificationStatus: "verified",
      ocrConfidence: "high",
      shopper: trip === "small" && rand() < 0.4 ? "בן משפחה" : "מרים (מטפלת)",
      imageStyle: "clear",
      ...extra,
    };
    receipts.push(r);
    return r;
  }

  // Regular weekly routine.
  for (let date = DEMO_START; date <= DEMO_END; date = addDays(date, 1)) {
    const wd = weekday(date);
    if (wd === 0) {
      // Sunday: main weekly shop.
      const lines: DemoLine[] = [];
      lines.push(line("milk3", 2));
      if (rand() < 0.85) lines.push(line("bread", 1));
      if (rand() < 0.5) lines.push(line("breadWhole", 1));
      if (daysSince("eggs", date) >= 9) lines.push(line("eggs", 1));
      if (rand() < 0.7) lines.push(line("whiteCheese", 1));
      if (rand() < 0.7) lines.push(line("cottage", rand() < 0.3 ? 2 : 1));
      if (rand() < 0.5) lines.push(line("yogurt", 2 + Math.floor(rand() * 3)));
      lines.push(line("tomato", 0.8 + rand() * 0.7));
      lines.push(line("cucumber", 0.7 + rand() * 0.6));
      if (rand() < 0.6) lines.push(line("banana", 0.9 + rand() * 0.6));
      if (rand() < 0.6) lines.push(line("chicken", 0.6 + rand() * 0.4));
      if (daysSince("coffee", date) >= 28) lines.push(line("coffee", 1));
      if (daysSince("water", date) >= 13) lines.push(line("water", 1));
      if (daysSince("toilet", date) >= 35) lines.push(line("toilet", 1));
      for (const k of ["tea", "oil", "sugar", "rice"]) if (rand() < 0.12) lines.push(line(k, 1));
      if (date >= "2026-09-17" && rand() < 0.75) lines.push(line("hummus", 1));
      // Occasional cottage promotion discount.
      const cottage = lines.find((l) => l.productKey === "cottage" && l.quantity === 2);
      if (cottage) cottage.discountAgorot = 200;
      addReceipt("main", date, lines);
    } else if (wd === 4) {
      // Thursday: small top-up shop.
      const lines: DemoLine[] = [];
      if (rand() < 0.8) lines.push(line("milk3", 1));
      if (rand() < 0.2) lines.push(line("milk1", 1));
      if (rand() < 0.85) lines.push(line("bread", 1));
      if (daysSince("eggs", date) >= 9) lines.push(line("eggs", 1));
      if (rand() < 0.4) lines.push(line("yogurt", 2));
      if (rand() < 0.4) lines.push(line("apple", 0.8 + rand() * 0.5));
      if (date >= "2026-09-17" && rand() < 0.3) lines.push(line("hummus", 1));
      if (lines.length === 0) lines.push(line("bread", 1));
      addReceipt("small", date, lines);
    } else if (wd === 2 && Number(date.slice(8, 10)) % 14 < 7) {
      // Every other Tuesday: fruit and vegetables at the market.
      addReceipt("market", date, [
        line("tomato", 1 + rand()),
        line("cucumber", 0.8 + rand() * 0.5),
        line("banana", 1 + rand() * 0.5),
        line("apple", 0.8 + rand() * 0.6),
      ]);
    }
  }

  // ---- Deliberate scenarios ----
  const byDate = (d: string, store?: Trip) =>
    receipts.find((r) => r.purchaseDate === d && (!store || r.store === STORES[store]))!;
  const recompute = (r: DemoReceipt) => {
    r.totalAgorot = r.lines.reduce((s, l) => s + l.lineTotalAgorot - (l.discountAgorot ?? 0), 0);
  };

  // Quantity spike: six litres of milk in one purchase (09/08/2026).
  {
    const r = byDate("2026-08-09", "main");
    const milk = r.lines.find((l) => l.productKey === "milk3")!;
    Object.assign(milk, line("milk3", 6, { aliasIndex: 0 }));
    recompute(r);
  }

  // Coffee: three jars at once in September, then repeated short-interval
  // purchases in October (04, 07 and 15/10).
  {
    const r = byDate("2026-09-13", "main");
    r.lines = r.lines.filter((l) => l.productKey !== "coffee");
    r.lines.push(line("coffee", 3));
    recompute(r);
    for (const [d, trip] of [["2026-10-04", "main"], ["2026-10-08", "small"], ["2026-10-15", "small"]] as const) {
      const rr = byDate(d, trip);
      rr.lines = rr.lines.filter((l) => l.productKey !== "coffee");
      rr.lines.push(line("coffee", 1));
      recompute(rr);
    }
  }

  // Products not normally expected for her.
  {
    const r1 = byDate("2026-10-08", "small");
    r1.lines.push(line("energy", 4));
    recompute(r1);
    const r2 = byDate("2026-10-22", "small");
    r2.lines.push(line("energy", 6));
    recompute(r2);
    const r3 = byDate("2026-09-24", "small");
    r3.lines.push(line("dogFood", 1));
    recompute(r3);
  }

  // A return line (negative) and a separate store discount line.
  {
    const r = byDate("2026-07-05", "main");
    r.lines.push(line("yogurt", -1, { lineType: "return", description: "החזרה: יוגורט טבעי 3% 200 גרם", aliasIndex: 0 }));
    r.lines.push({
      description: "הנחת מועדון",
      matchStatus: "unmatched",
      lineType: "discount",
      quantity: 1,
      unit: "unit",
      lineTotalAgorot: -500,
      confidence: "high",
      lowConfidenceFields: [],
    });
    recompute(r);
  }

  // Two receipts on the same day from different stores (16/07/2026).
  addReceipt("main", "2026-07-16", [line("milk3", 1), line("eggs", 1), line("chicken", 0.8)], {
    notes: "קנייה שנייה באותו יום — חסרו מצרכים לשבת",
  });

  // Incomplete receipt: torn, printed total missing (27/08/2026).
  {
    const r = byDate("2026-08-27", "small");
    r.totalAgorot = undefined;
    r.imageStyle = "torn";
    r.notes = "הקבלה קרועה בתחתית — הסכום הכולל אינו קריא";
  }

  // Unexplained total mismatch: printed total is ₪4.00 higher than the lines.
  {
    const r = byDate("2026-09-03", "small");
    recompute(r);
    r.totalAgorot = (r.totalAgorot ?? 0) + 400;
  }

  // Duplicates: the same photo uploaded twice, and the same receipt
  // photographed again (same number, store, date and total).
  {
    const original = byDate("2026-08-20", "small");
    receipts.push({
      ...structuredClone(original),
      key: `${original.key}-dup-file`,
      verificationStatus: "draft",
      sameFileAs: original.key,
      duplicateOfKey: original.key,
      duplicateReason: "אותו קובץ תמונה בדיוק כבר הועלה",
      notes: undefined,
    });
    const original2 = byDate("2026-10-11", "main");
    receipts.push({
      ...structuredClone(original2),
      key: `${original2.key}-dup-photo`,
      verificationStatus: "draft",
      imageStyle: "blurry",
      ocrConfidence: "medium",
      duplicateOfKey: original2.key,
      duplicateReason: "אותו מספר קבלה, חנות, תאריך וסכום כמו קבלה קיימת",
    });
  }

  // Low-confidence OCR drafts awaiting review, with inconsistent wording.
  {
    const r = byDate("2026-10-25", "main");
    r.verificationStatus = "draft";
    r.imageStyle = "blurry";
    r.ocrConfidence = "low";
    r.lines = [
      line("milk3", 2, { aliasIndex: 1 }),
      { ...line("milk3", 1), description: "חלב טרי 3 אחו 1 ל", productKey: undefined, matchStatus: "unmatched", confidence: "low", lowConfidenceFields: ["description"] },
      { ...line("eggs", 1), description: "ביצים L 12", productKey: undefined, matchStatus: "unmatched", confidence: "medium", lowConfidenceFields: ["description"] },
      { ...line("cottage", 1), description: "קוטג׳ 5%", productKey: undefined, matchStatus: "unmatched", confidence: "low", lowConfidenceFields: ["description", "unitPrice"] },
      line("tomato", 1.2),
      { ...line("banana", 1.1), confidence: "low", lowConfidenceFields: ["quantity", "lineTotal"] },
    ];
    recompute(r);

    // Missing date: the top of the receipt is unreadable.
    receipts.push({
      key: "missing-date",
      store: STORES.small,
      purchaseDate: undefined,
      time: "17:10",
      receiptNumber: undefined,
      totalAgorot: 2770,
      lines: [
        line("bread", 1, { aliasIndex: 0 }),
        { ...line("yogurt", 2, { aliasIndex: 1 }), confidence: "medium", lowConfidenceFields: ["quantity"] },
        line("milk3", 1, { aliasIndex: 0 }),
      ],
      verificationStatus: "draft",
      ocrConfidence: "low",
      shopper: undefined,
      imageStyle: "torn",
      notes: "החלק העליון של הקבלה חסר — אין תאריך ומספר קבלה",
    });
  }

  receipts.sort((a, b) => (a.purchaseDate ?? "9999").localeCompare(b.purchaseDate ?? "9999"));
  return { products: PRODUCTS, receipts };
}

/** Plain-text rendering used both for the receipt image and as "OCR raw text". */
export function receiptText(r: DemoReceipt): string[] {
  const rows: string[] = [r.store.name, r.store.address];
  if (r.purchaseDate) {
    const [y, m, d] = r.purchaseDate.split("-");
    rows.push(`תאריך: ${d}/${m}/${y}   שעה: ${r.time}`);
  }
  if (r.receiptNumber) rows.push(`קבלה מס': ${r.receiptNumber}`);
  rows.push("--------------------------------");
  for (const l of r.lines) {
    const amount = (l.lineTotalAgorot / 100).toFixed(2);
    if (l.lineType === "item" || l.lineType === "return") {
      const qty = l.unit === "kg" ? `${l.quantity.toFixed(3)} ק"ג` : `${l.quantity}`;
      const price = l.unitPriceAgorot != null ? (l.unitPriceAgorot / 100).toFixed(2) : "";
      rows.push(`${l.description}`);
      rows.push(`   ${qty} x ${price}   ${amount}`);
      if (l.discountAgorot) rows.push(`   הנחה   -${(l.discountAgorot / 100).toFixed(2)}`);
    } else {
      rows.push(`${l.description}   ${amount}`);
    }
  }
  rows.push("--------------------------------");
  if (r.totalAgorot != null) rows.push(`סה"כ לתשלום: ${(r.totalAgorot / 100).toFixed(2)}`);
  rows.push("תודה ולהתראות!");
  return rows;
}
