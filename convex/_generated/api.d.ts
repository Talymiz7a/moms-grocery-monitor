/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiUsage from "../aiUsage.js";
import type * as alerts from "../alerts.js";
import type * as analytics from "../analytics.js";
import type * as app from "../app.js";
import type * as demo from "../demo.js";
import type * as fileAccess from "../fileAccess.js";
import type * as files from "../files.js";
import type * as freeOcr from "../freeOcr.js";
import type * as geminiOcr from "../geminiOcr.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_anomalies from "../lib/anomalies.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_demoData from "../lib/demoData.js";
import type * as lib_facts from "../lib/facts.js";
import type * as lib_fileLinks from "../lib/fileLinks.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_ocrMerge from "../lib/ocrMerge.js";
import type * as lib_ocrSchema from "../lib/ocrSchema.js";
import type * as lib_productMatch from "../lib/productMatch.js";
import type * as lib_receiptOps from "../lib/receiptOps.js";
import type * as lib_receiptParser from "../lib/receiptParser.js";
import type * as lib_receiptSvg from "../lib/receiptSvg.js";
import type * as lib_recompute from "../lib/recompute.js";
import type * as lib_reconcile from "../lib/reconcile.js";
import type * as ocr from "../ocr.js";
import type * as ocrStore from "../ocrStore.js";
import type * as products from "../products.js";
import type * as receipts from "../receipts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiUsage: typeof aiUsage;
  alerts: typeof alerts;
  analytics: typeof analytics;
  app: typeof app;
  demo: typeof demo;
  fileAccess: typeof fileAccess;
  files: typeof files;
  freeOcr: typeof freeOcr;
  geminiOcr: typeof geminiOcr;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/analytics": typeof lib_analytics;
  "lib/anomalies": typeof lib_anomalies;
  "lib/config": typeof lib_config;
  "lib/dates": typeof lib_dates;
  "lib/demoData": typeof lib_demoData;
  "lib/facts": typeof lib_facts;
  "lib/fileLinks": typeof lib_fileLinks;
  "lib/gemini": typeof lib_gemini;
  "lib/money": typeof lib_money;
  "lib/normalize": typeof lib_normalize;
  "lib/ocrMerge": typeof lib_ocrMerge;
  "lib/ocrSchema": typeof lib_ocrSchema;
  "lib/productMatch": typeof lib_productMatch;
  "lib/receiptOps": typeof lib_receiptOps;
  "lib/receiptParser": typeof lib_receiptParser;
  "lib/receiptSvg": typeof lib_receiptSvg;
  "lib/recompute": typeof lib_recompute;
  "lib/reconcile": typeof lib_reconcile;
  ocr: typeof ocr;
  ocrStore: typeof ocrStore;
  products: typeof products;
  receipts: typeof receipts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
