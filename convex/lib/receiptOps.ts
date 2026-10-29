import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { confidenceValidator, lineTypeValidator, unitValidator } from "../schema";
import { normalizeText } from "./normalize";

export type Dataset = "demo" | "real";

export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    dataset: Dataset;
    actor: string;
    action: string;
    entityType: Doc<"auditLog">["entityType"];
    entityId?: string;
    summary: string;
    details?: unknown;
  },
) {
  await ctx.db.insert("auditLog", {
    dataset: entry.dataset,
    at: Date.now(),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    detailsJson: entry.details === undefined ? undefined : JSON.stringify(entry.details),
  });
}

export type DuplicateMatch = { id: Id<"receipts">; reason: string };

/**
 * Looks for an existing receipt that is probably the same purchase:
 * 1. the exact same file (SHA-256 fingerprint),
 * 2. the same receipt number at the same store,
 * 3. the same store, date and printed total (and item count when known).
 * A person can override the result; nothing is deleted automatically.
 */
export async function findDuplicate(
  ctx: QueryCtx,
  dataset: Dataset,
  probe: {
    excludeId?: Id<"receipts">;
    sha256?: string;
    receiptNumber?: string;
    storeName?: string;
    purchaseDate?: string;
    totalAgorot?: number;
    itemCount?: number;
  },
): Promise<DuplicateMatch | null> {
  const others = (r: Doc<"receipts">) => r._id !== probe.excludeId;
  const sameStore = (a?: string, b?: string) => !!a && !!b && normalizeText(a) === normalizeText(b);

  if (probe.sha256) {
    const hits = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_sha", (q) => q.eq("dataset", dataset).eq("fileSha256", probe.sha256))
      .collect();
    const hit = hits.filter(others).sort((a, b) => a.uploadedAt - b.uploadedAt)[0];
    if (hit) return { id: hit._id, reason: "אותו קובץ תמונה בדיוק כבר הועלה" };
  }
  if (probe.receiptNumber) {
    const hits = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_number", (q) => q.eq("dataset", dataset).eq("receiptNumber", probe.receiptNumber))
      .collect();
    const hit = hits.filter(others).find((r) => sameStore(r.storeName, probe.storeName));
    if (hit) return { id: hit._id, reason: "אותו מספר קבלה באותה חנות כבר קיים" };
  }
  if (probe.purchaseDate && probe.totalAgorot != null && probe.storeName) {
    const hits = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", dataset).eq("purchaseDate", probe.purchaseDate))
      .collect();
    const hit = hits
      .filter(others)
      .find(
        (r) =>
          r.totalAgorot === probe.totalAgorot &&
          sameStore(r.storeName, probe.storeName) &&
          (probe.itemCount === undefined || r.itemCount === undefined || r.itemCount === probe.itemCount),
      );
    if (hit) return { id: hit._id, reason: "אותה חנות, תאריך וסכום כמו קבלה קיימת" };
  }
  return null;
}

export const productChoiceValidator = v.union(
  v.object({ kind: v.literal("existing"), productId: v.id("products") }),
  v.object({ kind: v.literal("new"), canonicalName: v.string(), unit: unitValidator }),
  v.object({ kind: v.literal("none") }),
);

export const reviewLineValidator = v.object({
  originalDescription: v.string(),
  lineType: lineTypeValidator,
  quantity: v.number(),
  unit: unitValidator,
  unitPriceAgorot: v.optional(v.number()),
  lineTotalAgorot: v.number(),
  discountAgorot: v.optional(v.number()),
  confidence: confidenceValidator,
  lowConfidenceFields: v.array(v.string()),
  corrected: v.boolean(),
  product: productChoiceValidator,
});

export type ReviewLine = Infer<typeof reviewLineValidator>;

export const reviewHeaderValidator = v.object({
  storeName: v.optional(v.string()),
  purchaseDate: v.optional(v.string()),
  receiptNumber: v.optional(v.string()),
  totalAgorot: v.optional(v.number()),
  shopper: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export function cleanText(s: string | undefined, max = 200): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim().slice(0, max);
  return t === "" ? undefined : t;
}

export function isWholeAgorot(n: number | undefined): boolean {
  return n === undefined || (Number.isInteger(n) && Math.abs(n) < 100_000_000);
}
