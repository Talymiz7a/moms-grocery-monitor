import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Dataset } from "./receiptOps";

/** Re-runs anomaly detection after any change that can affect alerts. */
export async function scheduleRecompute(ctx: MutationCtx, dataset: Dataset) {
  await ctx.scheduler.runAfter(0, internal.alerts.recompute, { dataset });
}
