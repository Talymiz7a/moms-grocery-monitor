import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { buildOccasions, type FactItem, type FactProduct, type FactReceipt } from "./analytics";
import type { Dataset } from "./receiptOps";

/**
 * Loads the verified, dated receipts of one dataset with their confirmed
 * lines, and turns them into purchase occasions. Lines of a merged product
 * count under the product they were merged into.
 */
export async function loadFacts(ctx: QueryCtx, dataset: Dataset) {
  const [receiptDocs, itemDocs, productDocs] = await Promise.all([
    ctx.db.query("receipts").withIndex("by_dataset_date", (q) => q.eq("dataset", dataset)).collect(),
    ctx.db.query("receiptItems").withIndex("by_dataset_date", (q) => q.eq("dataset", dataset)).collect(),
    ctx.db.query("products").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).collect(),
  ]);
  const productDoc = new Map(productDocs.map((p) => [p._id as string, p]));
  const resolve = (id: string): string => {
    let p = productDoc.get(id);
    for (let i = 0; p?.mergedIntoId && i < 10; i++) p = productDoc.get(p.mergedIntoId);
    return (p?._id as string) ?? id;
  };
  const verified = receiptDocs.filter((r) => r.verificationStatus === "verified" && r.purchaseDate);
  const receipts: FactReceipt[] = verified.map((r) => ({
    id: r._id,
    date: r.purchaseDate!,
    storeName: r.storeName,
    totalAgorot: r.totalAgorot,
    computedTotalAgorot: r.reconciliation?.computedTotalAgorot,
    itemCount: r.itemCount ?? 0,
  }));
  const items: FactItem[] = itemDocs
    .filter((i) => i.matchStatus === "confirmed" && i.productId)
    .map((i) => ({
      receiptId: i.receiptId,
      productId: resolve(i.productId!),
      lineType: i.lineType,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceAgorot: i.unitPriceAgorot,
      lineTotalAgorot: i.lineTotalAgorot,
      discountAgorot: i.discountAgorot,
    }));
  const products: FactProduct[] = productDocs
    .filter((p) => !p.mergedIntoId)
    .map((p) => ({
      id: p._id,
      name: p.canonicalName,
      unit: p.unit,
      packageSize: p.packageSize,
      packageUnit: p.packageUnit,
      category: p.category,
    }));
  const occasions = buildOccasions(receipts, items, products);
  const dates = receipts.map((r) => r.date).sort();
  return {
    receipts,
    receiptDocs,
    productDocs: productDocs as Doc<"products">[],
    products,
    occasions,
    firstMonth: dates[0]?.slice(0, 7) ?? null,
    lastMonth: dates[dates.length - 1]?.slice(0, 7) ?? null,
  };
}
