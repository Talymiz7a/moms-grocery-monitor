# Mom's Grocery Monitor (מעקב קניות אמא)

A private, Hebrew (RTL) web app for monitoring grocery purchases made for an elderly
mother: receipt upload and reading, purchase-frequency analysis and review of unusual
purchases. It is a monitoring tool, not a budgeting app — an anomaly is not proof of
misconduct; the app shows evidence and supports human review.

**Status: Stages 1–5 built — preview with fictional demo data, awaiting review and approval.
Real data and paid OCR are disabled until approved.**

| Stage | Scope | Status |
|---|---|---|
| 1 | Database, Hebrew interface, navigation, upload, OCR, manual review | ✅ built |
| 2 | Searches, frequency calculations, grouped monthly chart, quantity analysis, history | ✅ built |
| 3 | Expected shopping rules, anomalies, duplicate alerts, review statuses | ✅ built |
| 4 | Dashboard, reports, exports | ✅ built |
| 5 | Five-month demo verification and end-to-end testing | ✅ built — awaiting your review |

## Screens

| Route | Screen |
|---|---|
| `/` | Dashboard — period filter (all / month / year / range), summary cards, monthly frequency chart, top products, unusual patterns, recent receipts, receipts awaiting review |
| `/upload` | Upload Receipt — camera, image or PDF; or manual entry |
| `/receipts`, `/receipts/:id`, `/receipts/:id/review` | Receipts & Purchases — date search with item view, product search, sorting, details, review/edit |
| `/analysis`, `/analysis/products/:id` | Product Analysis — grouped products × 12 months chart, product history |
| `/alerts` | Alerts & Review — evidence, statuses, notes, history |
| `/reports` | Reports & export — CSV, Excel, PDF (A4 landscape) |
| `/settings`, `/settings/products` | Settings — sensitivity, products, expected shopping list, merge/split |

## Anomaly detection (transparent and configurable)

| Alert | Rule (from the expected shopping list) | Statistical (own history, needs enough data) |
|---|---|---|
| Excessive frequency | more purchases in a month than *max per month* | month above mean + k·sd of prior months and ≥ ratio × mean (≥ 3 prior months) |
| Large quantity | quantity above *max quantity* | ≥ multiplier × median of prior purchases and above the prior maximum (≥ 5 prior) |
| Close together | fewer days than *minimum interval* | far shorter than the median interval and rare in this product's history (≥ 5 prior intervals) |
| New product | — | first purchase after the first 30 days of data (notice) |
| Not expected | product marked *not expected* / *manual review* | — |
| Duplicate receipt | same file fingerprint / receipt number + store / store + date + total + items | — |
| High total | — | above the same store's median + k·MAD (≥ 8 prior receipts), read with basket size |

Sensitivity (low / medium / high) sets k and the multipliers (`convex/lib/anomalies.ts`).
Explained alerts stay closed unless their evidence changes. Alerts never infer intent.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, React Router. Hebrew
  RTL throughout (`<html lang="he" dir="rtl">`), DD/MM/YYYY dates, ILS amounts.
- **Backend & storage:** [Convex](https://convex.dev) — database, file storage for
  receipts, server functions (`convex/`).
- **Hosting:** Vercel (static build; `vercel.json` deploys Convex functions then builds).
- **OCR:** Claude via the Anthropic API (`convex/ocr.ts`), **disabled by default**.

### Key rules implemented

- **Demo and real data never mix.** Every record has `dataset: "demo" | "real"`, and
  every index and query starts with it. Demo reset deletes demo records only. Real data
  is disabled in the UI until authentication is set up.
- **Counting:** purchase *frequency* = number of distinct receipts containing a product;
  *quantity* = summed units; six units on one receipt (or several lines of the same
  product) are **one** purchase occasion. Only verified receipts and confirmed product
  identities count.
- **Money** is stored as integer agorot. Receipt lines are reconciled against the
  printed total; differences are shown, never silently corrected.
- **OCR never invents values:** unreadable fields stay empty and are flagged
  low-confidence; every receipt goes through a review screen before it counts.
- **Product matching** suggests matches; a person confirms. Different sizes or fat
  percentages (e.g. milk 3% vs 1%) are never proposed as a strong match. Only exact,
  previously confirmed wording is matched automatically.
- **Duplicates** (same file fingerprint, same receipt number + store, or same store +
  date + total) block approval until a person overrides or deletes.
- **Receipt files** are never served from public URLs: the app requests a 10-minute
  HMAC-signed link that an HTTP action verifies (`convex/http.ts`).
- **Audit log** records uploads, OCR runs, reviews, overrides and deletions.
- **Write protection (temporary):** the preview has no login; anyone can view demo
  data, but every change requires `EDITOR_CODE`. Must be replaced by real
  authentication before real receipts are used.

## Deployments

| Service | Resource | Notes |
|---|---|---|
| Convex | project `moms-grocery-monitor` (team `talymiz`) | production deployment backs the preview; dev deployment for development |
| Vercel | project `moms-grocery-monitor` | preview: https://moms-grocery-monitor.vercel.app (demo data, read-only) |

Deploy (from a machine logged in to both CLIs):

```bash
npx convex deploy                 # push backend functions/schema to Convex production
npx convex run --prod demo:seed   # (re)load demo data — replaces demo records only
npx vercel deploy                 # preview deployment of the static site
```

Vercel needs `VITE_CONVEX_URL` (the Convex production URL) in its Preview and
Production environments. The Vercel build only runs `npm run build`; Convex is
deployed separately.

## Environment variables

Set in the **Convex dashboard → Settings → Environment Variables** (never in the repo):

| Variable | Required | Purpose |
|---|---|---|
| `EDITOR_CODE` | yes | Code that unlocks editing (min. 8 chars). Unset = everything read-only. |
| `FILE_LINK_SECRET` | yes | Random secret (≥16 chars) for signing receipt-file links. |
| `OCR_ENABLED` | no | `true` to allow paid Claude OCR calls. Off by default. |
| `ANTHROPIC_API_KEY` | no | Anthropic API key, needed only when `OCR_ENABLED=true`. |
| `OCR_MODEL` | no | Model ID. Default `claude-opus-5-5`. |

Set in **Vercel → Project → Settings → Environment Variables**:

| Variable | Purpose |
|---|---|
| `VITE_CONVEX_URL` | Convex production URL the website connects to (public value). |

## Development

```bash
npm install
npx convex dev          # creates/links a Convex deployment and regenerates convex/_generated
npm run dev             # Vite dev server
```

Load the demo data (five fictional months, 01/06/2026–28/10/2026):

```bash
npx convex run demo:seed
```

Checks:

```bash
npm test                # unit tests + Convex backend tests (convex-test)
npm run typecheck
npm run build
```

## Demo data scenarios

The deterministic demo dataset (`convex/lib/demoData.ts`) includes normal recurring
purchases, a quantity spike (6 litres of milk), short-interval repeats (coffee in
October), new products (hummus from September), products not normally expected
(energy drinks, dog food), two duplicate receipts (same file; re-photographed),
inconsistent product wording, low-confidence OCR drafts, discounts, a return line,
two receipts on the same day, a torn receipt with no total, a receipt with no date
and an unexplained total mismatch. Every demo receipt has a generated receipt image.
