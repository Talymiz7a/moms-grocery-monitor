import { httpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fileLinkSecret, verifyFileLink } from "./lib/fileLinks";

const http = httpRouter();

const SECURITY_HEADERS = {
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

http.route({
  path: "/receipt-file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const receiptId = url.searchParams.get("r") ?? "";
    const expiresAt = Number(url.searchParams.get("e"));
    const sig = url.searchParams.get("s") ?? "";
    const secret = fileLinkSecret();
    if (!secret || !(await verifyFileLink(secret, receiptId, expiresAt, sig, Date.now()))) {
      return new Response("הקישור אינו תקף או שפג תוקפו", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const file = await ctx.runQuery(internal.fileAccess.fileForReceipt, { receiptId: receiptId as Id<"receipts"> });
    if (!file) return new Response("לא נמצא", { status: 404 });
    const blob = await ctx.storage.get(file.fileId);
    if (!blob) return new Response("לא נמצא", { status: 404 });
    return new Response(blob, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        // Images are rendered in a locked-down sandbox. Browsers' built-in PDF
        // viewers do not work inside a CSP sandbox, so PDFs omit it.
        ...(file.fileType === "application/pdf"
          ? {}
          : { "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }),
        "Content-Type": file.fileType || "application/octet-stream",
        "Content-Disposition": "inline",
      },
    });
  }),
});

export default http;
