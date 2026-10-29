import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { datasetValidator } from "./schema";
import { EDITOR_ACTOR, isEditorCodeValid, requireEditor } from "./lib/access";
import { FILE_LINK_TTL_MS, fileLinkSecret, signFileLink } from "./lib/fileLinks";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "./lib/config";
import { findDuplicate, writeAudit } from "./lib/receiptOps";

export const generateUploadUrl = mutation({
  args: { editorCode: v.string() },
  handler: async (ctx, { editorCode }) => {
    requireEditor(editorCode);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Registers an uploaded file as a new draft receipt awaiting review. */
export const createDraftFromUpload = mutation({
  args: {
    editorCode: v.string(),
    dataset: datasetValidator,
    storageId: v.id("_storage"),
    ocrStorageId: v.optional(v.id("_storage")),
    fileName: v.string(),
  },
  handler: async (ctx, { editorCode, dataset, storageId, ocrStorageId, fileName }) => {
    requireEditor(editorCode);
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw new ConvexError("הקובץ לא נמצא באחסון");
    const contentType = meta.contentType ?? "";
    if (!ALLOWED_UPLOAD_TYPES.includes(contentType) || meta.size > MAX_UPLOAD_BYTES) {
      await ctx.storage.delete(storageId);
      throw new ConvexError("סוג הקובץ או גודלו אינם נתמכים (תמונה או PDF עד 15MB)");
    }
    let ocrFileId = ocrStorageId;
    if (ocrStorageId) {
      const ocrMeta = await ctx.db.system.get(ocrStorageId);
      if (!ocrMeta || ocrMeta.contentType !== "image/jpeg" || ocrMeta.size > 4.5 * 1024 * 1024) {
        if (ocrMeta) await ctx.storage.delete(ocrStorageId);
        ocrFileId = undefined;
      }
    }
    // The fingerprint comes from the storage system, not from the browser.
    const sha256 = meta.sha256;
    const duplicate = await findDuplicate(ctx, dataset, { sha256 });
    const now = Date.now();
    const receiptId = await ctx.db.insert("receipts", {
      dataset,
      purchaseDateSource: "missing",
      fileId: storageId,
      fileName: fileName.slice(0, 200),
      fileType: contentType,
      fileSha256: sha256,
      ocrFileId,
      ocrStatus: "not_run",
      verificationStatus: "draft",
      duplicateOfId: duplicate?.id,
      duplicateReason: duplicate?.reason,
      itemCount: 0,
      uploadedAt: now,
      updatedAt: now,
      createdBy: EDITOR_ACTOR,
    });
    await writeAudit(ctx, {
      dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.upload",
      entityType: "receipt",
      entityId: receiptId,
      summary: `הועלה קובץ קבלה: ${fileName.slice(0, 80)}` + (duplicate ? ` · ${duplicate.reason}` : ""),
    });
    return { receiptId, duplicate };
  },
});

/** A receipt entered by hand, without a file. */
export const createManualDraft = mutation({
  args: { editorCode: v.string(), dataset: datasetValidator },
  handler: async (ctx, { editorCode, dataset }) => {
    requireEditor(editorCode);
    const now = Date.now();
    const receiptId = await ctx.db.insert("receipts", {
      dataset,
      purchaseDateSource: "missing",
      ocrStatus: "manual",
      verificationStatus: "draft",
      itemCount: 0,
      uploadedAt: now,
      updatedAt: now,
      createdBy: EDITOR_ACTOR,
    });
    await writeAudit(ctx, {
      dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.createManual",
      entityType: "receipt",
      entityId: receiptId,
      summary: "נוצרה קבלה להזנה ידנית (ללא קובץ)",
    });
    return { receiptId };
  },
});

/**
 * Returns a short-lived signed link to the original receipt file.
 * Demo receipts can be viewed by anyone; real receipts require the editor code.
 */
export const getFileLink = mutation({
  args: { receiptId: v.id("receipts"), editorCode: v.optional(v.string()) },
  handler: async (ctx, { receiptId, editorCode }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt || !receipt.fileId) return null;
    if (receipt.dataset === "real" && !isEditorCodeValid(editorCode)) {
      throw new ConvexError("נדרש קוד עורך כדי לצפות בקבלות אמיתיות");
    }
    const secret = fileLinkSecret();
    const site = process.env.CONVEX_SITE_URL;
    if (!secret || !site) throw new ConvexError("צפייה בקבצים לא הוגדרה בשרת (FILE_LINK_SECRET)");
    const expiresAt = Date.now() + FILE_LINK_TTL_MS;
    const sig = await signFileLink(secret, receiptId, expiresAt);
    const url = new URL("/receipt-file", site);
    url.searchParams.set("r", receiptId);
    url.searchParams.set("e", String(expiresAt));
    url.searchParams.set("s", sig);
    return { url: url.toString(), fileType: receipt.fileType ?? "", expiresAt };
  },
});
