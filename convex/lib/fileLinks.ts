// Short-lived signed links for receipt files.
//
// Receipt files are never served from public storage URLs. Instead the app
// asks for a link, which is an HTTP-action URL carrying the receipt ID, an
// expiry time and an HMAC signature made with FILE_LINK_SECRET. The HTTP
// action re-checks the signature and expiry before streaming the file.

export const FILE_LINK_TTL_MS = 10 * 60 * 1000;

function toBase64Url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export function fileLinkSecret(): string | null {
  const s = process.env.FILE_LINK_SECRET;
  return s && s.length >= 16 ? s : null;
}

export async function signFileLink(secret: string, receiptId: string, expiresAt: number): Promise<string> {
  return hmac(secret, `${receiptId}.${expiresAt}`);
}

export async function verifyFileLink(
  secret: string,
  receiptId: string,
  expiresAt: number,
  signature: string,
  now: number,
): Promise<boolean> {
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = await hmac(secret, `${receiptId}.${expiresAt}`);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
