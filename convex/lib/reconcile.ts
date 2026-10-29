// Reconciles extracted receipt lines with the printed receipt total.
// Figures are never adjusted automatically: differences are reported so a
// person can decide what is right.

export type LineType = "item" | "discount" | "return" | "deposit";

export type ReconcileLine = {
  lineType: LineType;
  quantity: number;
  unitPriceAgorot?: number | null;
  lineTotalAgorot: number;
  /** Positive amount discounted on this specific line. */
  discountAgorot?: number | null;
};

export type LineCheck = {
  index: number;
  /** quantity × unit price does not equal the line total. */
  arithmeticMismatch: boolean;
  expectedAgorot?: number;
};

export type Reconciliation = {
  status: "match" | "mismatch" | "no_total" | "no_lines";
  linesTotalAgorot: number;
  discountsAgorot: number;
  computedTotalAgorot: number;
  printedTotalAgorot: number | null;
  differenceAgorot: number | null;
  lineChecks: LineCheck[];
};

/** Differences up to this many agorot are treated as rounding. */
export const ROUNDING_TOLERANCE_AGOROT = 1;

export function reconcile(lines: ReconcileLine[], printedTotalAgorot: number | null | undefined): Reconciliation {
  let linesTotal = 0;
  let discounts = 0;
  const lineChecks: LineCheck[] = [];
  lines.forEach((l, index) => {
    linesTotal += l.lineTotalAgorot;
    discounts += l.discountAgorot ?? 0;
    if (l.lineType === "item" && l.unitPriceAgorot != null && l.quantity !== 0) {
      const expected = Math.round(l.unitPriceAgorot * l.quantity);
      if (Math.abs(expected - l.lineTotalAgorot) > ROUNDING_TOLERANCE_AGOROT) {
        lineChecks.push({ index, arithmeticMismatch: true, expectedAgorot: expected });
      }
    }
  });
  const computed = linesTotal - discounts;
  const printed = printedTotalAgorot ?? null;
  let status: Reconciliation["status"];
  let difference: number | null = null;
  if (lines.length === 0) status = "no_lines";
  else if (printed === null) status = "no_total";
  else {
    difference = printed - computed;
    status = Math.abs(difference) <= ROUNDING_TOLERANCE_AGOROT ? "match" : "mismatch";
  }
  return {
    status,
    linesTotalAgorot: linesTotal,
    discountsAgorot: discounts,
    computedTotalAgorot: computed,
    printedTotalAgorot: printed,
    differenceAgorot: difference,
    lineChecks,
  };
}
