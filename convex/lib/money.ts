// All amounts are stored as integer agorot (1 ILS = 100 agorot) so that sums
// never drift because of floating-point rounding.

export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100);
}

export function fromAgorot(agorot: number): number {
  return agorot / 100;
}

const ilsFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatIls(agorot: number | undefined | null): string {
  if (agorot === undefined || agorot === null) return "—";
  return ilsFormatter.format(agorot / 100);
}

/** Parses user input like "12.90", "12,90" or "₪ 12.9" into agorot. */
export function parseShekelInput(input: string): number | null {
  const cleaned = input.replace(/[₪\s]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return toAgorot(Number(cleaned));
}
