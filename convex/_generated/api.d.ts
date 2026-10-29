/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as app from "../app.js";
import type * as demo from "../demo.js";
import type * as fileAccess from "../fileAccess.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_demoData from "../lib/demoData.js";
import type * as lib_fileLinks from "../lib/fileLinks.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_ocrSchema from "../lib/ocrSchema.js";
import type * as lib_productMatch from "../lib/productMatch.js";
import type * as lib_receiptOps from "../lib/receiptOps.js";
import type * as lib_receiptSvg from "../lib/receiptSvg.js";
import type * as lib_reconcile from "../lib/reconcile.js";
import type * as ocr from "../ocr.js";
import type * as ocrStore from "../ocrStore.js";
import type * as products from "../products.js";
import type * as receipts from "../receipts.js";

declare const fullApi: ApiFromModules<{
  "app": typeof app;
  "demo": typeof demo;
  "fileAccess": typeof fileAccess;
  "files": typeof files;
  "http": typeof http;
  "lib/access": typeof lib_access;
  "lib/config": typeof lib_config;
  "lib/dates": typeof lib_dates;
  "lib/demoData": typeof lib_demoData;
  "lib/fileLinks": typeof lib_fileLinks;
  "lib/money": typeof lib_money;
  "lib/normalize": typeof lib_normalize;
  "lib/ocrSchema": typeof lib_ocrSchema;
  "lib/productMatch": typeof lib_productMatch;
  "lib/receiptOps": typeof lib_receiptOps;
  "lib/receiptSvg": typeof lib_receiptSvg;
  "lib/reconcile": typeof lib_reconcile;
  "ocr": typeof ocr;
  "ocrStore": typeof ocrStore;
  "products": typeof products;
  "receipts": typeof receipts;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: {};
