import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Every record belongs to exactly one dataset. Demo and real data are never
// mixed: every query and index starts with the dataset.
export const datasetValidator = v.union(v.literal("demo"), v.literal("real"));

export const lineTypeValidator = v.union(
  v.literal("item"),
  v.literal("discount"),
  v.literal("return"),
  v.literal("deposit"),
);

export const confidenceValidator = v.union(v.literal("high"), v.literal("medium"), v.literal("low"));

export const unitValidator = v.union(
  v.literal("unit"),
  v.literal("kg"),
  v.literal("g"),
  v.literal("l"),
  v.literal("ml"),
  v.literal("pack"),
);

export const expectedUseValidator = v.union(
  v.literal("expected"),
  v.literal("occasional"),
  v.literal("not_expected"),
  v.literal("manual_review"),
);

export const reconciliationValidator = v.object({
  status: v.union(v.literal("match"), v.literal("mismatch"), v.literal("no_total"), v.literal("no_lines")),
  linesTotalAgorot: v.number(),
  discountsAgorot: v.number(),
  computedTotalAgorot: v.number(),
  printedTotalAgorot: v.union(v.number(), v.null()),
  differenceAgorot: v.union(v.number(), v.null()),
});

export default defineSchema({
  receipts: defineTable({
    dataset: datasetValidator,
    // ISO "YYYY-MM-DD"; missing when the date could not be read or entered.
    purchaseDate: v.optional(v.string()),
    purchaseDateSource: v.union(v.literal("ocr"), v.literal("manual"), v.literal("missing")),
    storeName: v.optional(v.string()),
    receiptNumber: v.optional(v.string()),
    totalAgorot: v.optional(v.number()),
    // Original file, kept unchanged.
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSha256: v.optional(v.string()),
    // Downscaled JPEG copy made in the browser for receipt reading only;
    // the original file above is never modified.
    ocrFileId: v.optional(v.id("_storage")),
    ocrStatus: v.union(
      v.literal("not_run"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("manual"),
    ),
    ocrModel: v.optional(v.string()),
    ocrRawText: v.optional(v.string()),
    // Full structured OCR response as JSON text, kept for audit.
    ocrJson: v.optional(v.string()),
    ocrError: v.optional(v.string()),
    ocrConfidence: v.optional(confidenceValidator),
    // Header fields the OCR could not read with confidence.
    headerLowConfidence: v.optional(v.array(v.string())),
    // "draft" = not yet reviewed by a person; "verified" = reviewed and saved.
    verificationStatus: v.union(v.literal("draft"), v.literal("verified")),
    reconciliation: v.optional(reconciliationValidator),
    itemCount: v.optional(v.number()),
    // Duplicate handling: set when a likely duplicate was found.
    duplicateOfId: v.optional(v.id("receipts")),
    duplicateReason: v.optional(v.string()),
    // A person confirmed it is NOT a duplicate (manual override).
    duplicateOverride: v.optional(v.boolean()),
    shopper: v.optional(v.string()),
    notes: v.optional(v.string()),
    uploadedAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_dataset_date", ["dataset", "purchaseDate"])
    .index("by_dataset_sha", ["dataset", "fileSha256"])
    .index("by_dataset_number", ["dataset", "receiptNumber"])
    .index("by_dataset_status", ["dataset", "verificationStatus"])
    .index("by_dataset_uploaded", ["dataset", "uploadedAt"]),

  products: defineTable({
    dataset: datasetValidator,
    canonicalName: v.string(),
    // Raw receipt wordings confirmed to mean this product.
    aliases: v.array(v.string()),
    category: v.optional(v.string()),
    unit: unitValidator,
    // e.g. 1 (litre) for "חלב 1 ליטר", 250 (g) for a 250 g tub.
    packageSize: v.optional(v.number()),
    packageUnit: v.optional(unitValidator),
    expectedUse: expectedUseValidator,
    notes: v.optional(v.string()),
    // Set when this product was merged into another one.
    mergedIntoId: v.optional(v.id("products")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dataset_name", ["dataset", "canonicalName"])
    .index("by_dataset", ["dataset"]),

  receiptItems: defineTable({
    dataset: datasetValidator,
    receiptId: v.id("receipts"),
    // Copied from the receipt so date-range queries do not need a join.
    purchaseDate: v.optional(v.string()),
    lineIndex: v.number(),
    productId: v.optional(v.id("products")),
    // "confirmed": a person verified the product identity (or an exact,
    // previously confirmed alias). Only confirmed lines count in history.
    matchStatus: v.union(v.literal("confirmed"), v.literal("unmatched")),
    originalDescription: v.string(),
    lineType: lineTypeValidator,
    quantity: v.number(),
    unit: unitValidator,
    unitPriceAgorot: v.optional(v.number()),
    lineTotalAgorot: v.number(),
    discountAgorot: v.optional(v.number()),
    confidence: confidenceValidator,
    lowConfidenceFields: v.array(v.string()),
    // A person changed a value that came from OCR.
    corrected: v.boolean(),
  })
    .index("by_receipt", ["receiptId", "lineIndex"])
    .index("by_dataset_product_date", ["dataset", "productId", "purchaseDate"])
    .index("by_dataset_date", ["dataset", "purchaseDate"]),

  alerts: defineTable({
    dataset: datasetValidator,
    type: v.union(
      v.literal("excessive_frequency"),
      v.literal("large_quantity"),
      v.literal("close_interval"),
      v.literal("new_product"),
      v.literal("not_expected"),
      v.literal("duplicate_receipt"),
      v.literal("high_total"),
    ),
    // "rule" = user-configured threshold; "statistical" = compared with
    // history; "notice" = informational (e.g. new product).
    basis: v.union(v.literal("rule"), v.literal("statistical"), v.literal("notice")),
    productId: v.optional(v.id("products")),
    receiptIds: v.array(v.id("receipts")),
    detectedAt: v.number(),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    reason: v.string(),
    evidenceJson: v.string(),
    evidenceHash: v.string(),
    limitedEvidence: v.boolean(),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(v.literal("pending"), v.literal("explained"), v.literal("investigate")),
    notes: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    dedupeKey: v.string(),
    // The evidence no longer exists (receipt corrected or deleted); kept for history.
    inactive: v.optional(v.boolean()),
    reopenedAt: v.optional(v.number()),
    reviewHistory: v.optional(
      v.array(
        v.object({
          at: v.number(),
          actor: v.string(),
          status: v.union(v.literal("pending"), v.literal("explained"), v.literal("investigate")),
          notes: v.optional(v.string()),
        }),
      ),
    ),
  })
    .index("by_dataset_status", ["dataset", "status"])
    .index("by_dataset_dedupe", ["dataset", "dedupeKey"]),

  productExpectations: defineTable({
    dataset: datasetValidator,
    productId: v.id("products"),
    usualQuantity: v.optional(v.number()),
    usualUnit: v.optional(unitValidator),
    expectedIntervalDays: v.optional(v.number()),
    maxPerMonth: v.optional(v.number()),
    minIntervalDays: v.optional(v.number()),
    quantityMin: v.optional(v.number()),
    quantityMax: v.optional(v.number()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_dataset_product", ["dataset", "productId"]),

  settings: defineTable({
    dataset: datasetValidator,
    alertSensitivity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    updatedAt: v.number(),
  }).index("by_dataset", ["dataset"]),

  auditLog: defineTable({
    dataset: datasetValidator,
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    entityType: v.union(
      v.literal("receipt"),
      v.literal("receiptItem"),
      v.literal("product"),
      v.literal("alert"),
      v.literal("rule"),
      v.literal("demo"),
    ),
    entityId: v.optional(v.string()),
    summary: v.string(),
    detailsJson: v.optional(v.string()),
  })
    .index("by_dataset_entity", ["dataset", "entityType", "entityId"])
    .index("by_dataset_at", ["dataset", "at"]),
});
