/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as admin from "../admin.js";
import type * as amendments from "../amendments.js";
import type * as auth from "../auth.js";
import type * as authVerification from "../authVerification.js";
import type * as backs from "../backs.js";
import type * as bootstrap from "../bootstrap.js";
import type * as budget from "../budget.js";
import type * as chain from "../chain.js";
import type * as chainAdmin from "../chainAdmin.js";
import type * as crons from "../crons.js";
import type * as deployment from "../deployment.js";
import type * as earnings from "../earnings.js";
import type * as email from "../email.js";
import type * as feed from "../feed.js";
import type * as fulfillment from "../fulfillment.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as imageGen from "../imageGen.js";
import type * as imageNotes from "../imageNotes.js";
import type * as imageSizes from "../imageSizes.js";
import type * as images from "../images.js";
import type * as integrations from "../integrations.js";
import type * as invites from "../invites.js";
import type * as judges from "../judges.js";
import type * as keeps from "../keeps.js";
import type * as lib_adminAccess from "../lib/adminAccess.js";
import type * as lib_authEmail from "../lib/authEmail.js";
import type * as lib_authRateLimit from "../lib/authRateLimit.js";
import type * as lib_authVerification from "../lib/authVerification.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_batchPrompt from "../lib/batchPrompt.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_chain_abi from "../lib/chain/abi.js";
import type * as lib_chain_calldata from "../lib/chain/calldata.js";
import type * as lib_chain_custody from "../lib/chain/custody.js";
import type * as lib_chain_deps from "../lib/chain/deps.js";
import type * as lib_chain_eip712 from "../lib/chain/eip712.js";
import type * as lib_chain_events from "../lib/chain/events.js";
import type * as lib_chain_ids from "../lib/chain/ids.js";
import type * as lib_chain_queue from "../lib/chain/queue.js";
import type * as lib_chain_rpc from "../lib/chain/rpc.js";
import type * as lib_chain_writes from "../lib/chain/writes.js";
import type * as lib_chromaKey from "../lib/chromaKey.js";
import type * as lib_circle from "../lib/circle.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_colors from "../lib/colors.js";
import type * as lib_creatorPool from "../lib/creatorPool.js";
import type * as lib_creators from "../lib/creators.js";
import type * as lib_earlyAccess from "../lib/earlyAccess.js";
import type * as lib_economics from "../lib/economics.js";
import type * as lib_economicsConfigs from "../lib/economicsConfigs.js";
import type * as lib_fal from "../lib/fal.js";
import type * as lib_flagState from "../lib/flagState.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_garments from "../lib/garments.js";
import type * as lib_gridCut from "../lib/gridCut.js";
import type * as lib_imageCalls from "../lib/imageCalls.js";
import type * as lib_imageErrors from "../lib/imageErrors.js";
import type * as lib_imageUrls from "../lib/imageUrls.js";
import type * as lib_lineage from "../lib/lineage.js";
import type * as lib_metricsDays from "../lib/metricsDays.js";
import type * as lib_mime from "../lib/mime.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_notesWriter from "../lib/notesWriter.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_otp from "../lib/otp.js";
import type * as lib_paging from "../lib/paging.js";
import type * as lib_paidAttempts from "../lib/paidAttempts.js";
import type * as lib_partsReader from "../lib/partsReader.js";
import type * as lib_passwordAuth from "../lib/passwordAuth.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_photoShoots from "../lib/photoShoots.js";
import type * as lib_pngMeta from "../lib/pngMeta.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_printImage from "../lib/printImage.js";
import type * as lib_printKeys from "../lib/printKeys.js";
import type * as lib_printPng from "../lib/printPng.js";
import type * as lib_printful_client from "../lib/printful/client.js";
import type * as lib_printful_setup from "../lib/printful/setup.js";
import type * as lib_printful_webhookRoute from "../lib/printful/webhookRoute.js";
import type * as lib_printful_webhookVerify from "../lib/printful/webhookVerify.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_providerConfig from "../lib/providerConfig.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_redirect from "../lib/redirect.js";
import type * as lib_remixCompare from "../lib/remixCompare.js";
import type * as lib_remixFields from "../lib/remixFields.js";
import type * as lib_remixJudge from "../lib/remixJudge.js";
import type * as lib_remixParts from "../lib/remixParts.js";
import type * as lib_remixTarget from "../lib/remixTarget.js";
import type * as lib_remixWords from "../lib/remixWords.js";
import type * as lib_resize from "../lib/resize.js";
import type * as lib_roleReader from "../lib/roleReader.js";
import type * as lib_salePrep from "../lib/salePrep.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_shopColors from "../lib/shopColors.js";
import type * as lib_shopFlags from "../lib/shopFlags.js";
import type * as lib_shopLineage from "../lib/shopLineage.js";
import type * as lib_shopProduct from "../lib/shopProduct.js";
import type * as lib_shopify_adminClient from "../lib/shopify/adminClient.js";
import type * as lib_shopify_fulfillmentSync from "../lib/shopify/fulfillmentSync.js";
import type * as lib_shopify_orderQuery from "../lib/shopify/orderQuery.js";
import type * as lib_shopify_productSync from "../lib/shopify/productSync.js";
import type * as lib_shopify_reconcile from "../lib/shopify/reconcile.js";
import type * as lib_shopify_setup from "../lib/shopify/setup.js";
import type * as lib_shopify_webhookRoute from "../lib/shopify/webhookRoute.js";
import type * as lib_shopify_webhookVerify from "../lib/shopify/webhookVerify.js";
import type * as lib_sizes from "../lib/sizes.js";
import type * as lib_social from "../lib/social.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_studioRules from "../lib/studioRules.js";
import type * as lib_styleParts from "../lib/styleParts.js";
import type * as lib_trending from "../lib/trending.js";
import type * as lib_upscaleFlow from "../lib/upscaleFlow.js";
import type * as lib_username from "../lib/username.js";
import type * as lineage from "../lineage.js";
import type * as merch from "../merch.js";
import type * as metrics from "../metrics.js";
import type * as notifications from "../notifications.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as payouts from "../payouts.js";
import type * as phoneVerification from "../phoneVerification.js";
import type * as photos from "../photos.js";
import type * as print from "../print.js";
import type * as printTools from "../printTools.js";
import type * as privacy from "../privacy.js";
import type * as provenance from "../provenance.js";
import type * as publish from "../publish.js";
import type * as remixCheck from "../remixCheck.js";
import type * as remixFields from "../remixFields.js";
import type * as remixParts from "../remixParts.js";
import type * as remixPartsActions from "../remixPartsActions.js";
import type * as resources from "../resources.js";
import type * as sales from "../sales.js";
import type * as schema_budget from "../schema/budget.js";
import type * as schema_chain from "../schema/chain.js";
import type * as schema_cultremix from "../schema/cultremix.js";
import type * as schema_launch from "../schema/launch.js";
import type * as schema_lineage from "../schema/lineage.js";
import type * as schema_merch from "../schema/merch.js";
import type * as schema_print from "../schema/print.js";
import type * as schema_publish from "../schema/publish.js";
import type * as schema_shop from "../schema/shop.js";
import type * as schema_social from "../schema/social.js";
import type * as seed from "../seed.js";
import type * as shopify from "../shopify.js";
import type * as shopifyFulfill from "../shopifyFulfill.js";
import type * as sitemap from "../sitemap.js";
import type * as sizing from "../sizing.js";
import type * as sms from "../sms.js";
import type * as social from "../social.js";
import type * as storageMoves from "../storageMoves.js";
import type * as studio from "../studio.js";
import type * as testHelpers from "../testHelpers.js";
import type * as trending from "../trending.js";
import type * as upscale from "../upscale.js";
import type * as waitlist from "../waitlist.js";
import type * as wallets from "../wallets.js";
import type * as workEconomics from "../workEconomics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  admin: typeof admin;
  amendments: typeof amendments;
  auth: typeof auth;
  authVerification: typeof authVerification;
  backs: typeof backs;
  bootstrap: typeof bootstrap;
  budget: typeof budget;
  chain: typeof chain;
  chainAdmin: typeof chainAdmin;
  crons: typeof crons;
  deployment: typeof deployment;
  earnings: typeof earnings;
  email: typeof email;
  feed: typeof feed;
  fulfillment: typeof fulfillment;
  http: typeof http;
  identity: typeof identity;
  imageGen: typeof imageGen;
  imageNotes: typeof imageNotes;
  imageSizes: typeof imageSizes;
  images: typeof images;
  integrations: typeof integrations;
  invites: typeof invites;
  judges: typeof judges;
  keeps: typeof keeps;
  "lib/adminAccess": typeof lib_adminAccess;
  "lib/authEmail": typeof lib_authEmail;
  "lib/authRateLimit": typeof lib_authRateLimit;
  "lib/authVerification": typeof lib_authVerification;
  "lib/authz": typeof lib_authz;
  "lib/batchPrompt": typeof lib_batchPrompt;
  "lib/budget": typeof lib_budget;
  "lib/chain/abi": typeof lib_chain_abi;
  "lib/chain/calldata": typeof lib_chain_calldata;
  "lib/chain/custody": typeof lib_chain_custody;
  "lib/chain/deps": typeof lib_chain_deps;
  "lib/chain/eip712": typeof lib_chain_eip712;
  "lib/chain/events": typeof lib_chain_events;
  "lib/chain/ids": typeof lib_chain_ids;
  "lib/chain/queue": typeof lib_chain_queue;
  "lib/chain/rpc": typeof lib_chain_rpc;
  "lib/chain/writes": typeof lib_chain_writes;
  "lib/chromaKey": typeof lib_chromaKey;
  "lib/circle": typeof lib_circle;
  "lib/codes": typeof lib_codes;
  "lib/colors": typeof lib_colors;
  "lib/creatorPool": typeof lib_creatorPool;
  "lib/creators": typeof lib_creators;
  "lib/earlyAccess": typeof lib_earlyAccess;
  "lib/economics": typeof lib_economics;
  "lib/economicsConfigs": typeof lib_economicsConfigs;
  "lib/fal": typeof lib_fal;
  "lib/flagState": typeof lib_flagState;
  "lib/flags": typeof lib_flags;
  "lib/garments": typeof lib_garments;
  "lib/gridCut": typeof lib_gridCut;
  "lib/imageCalls": typeof lib_imageCalls;
  "lib/imageErrors": typeof lib_imageErrors;
  "lib/imageUrls": typeof lib_imageUrls;
  "lib/lineage": typeof lib_lineage;
  "lib/metricsDays": typeof lib_metricsDays;
  "lib/mime": typeof lib_mime;
  "lib/models": typeof lib_models;
  "lib/notesWriter": typeof lib_notesWriter;
  "lib/notifications": typeof lib_notifications;
  "lib/otp": typeof lib_otp;
  "lib/paging": typeof lib_paging;
  "lib/paidAttempts": typeof lib_paidAttempts;
  "lib/partsReader": typeof lib_partsReader;
  "lib/passwordAuth": typeof lib_passwordAuth;
  "lib/permissions": typeof lib_permissions;
  "lib/phone": typeof lib_phone;
  "lib/photoShoots": typeof lib_photoShoots;
  "lib/pngMeta": typeof lib_pngMeta;
  "lib/pricing": typeof lib_pricing;
  "lib/printImage": typeof lib_printImage;
  "lib/printKeys": typeof lib_printKeys;
  "lib/printPng": typeof lib_printPng;
  "lib/printful/client": typeof lib_printful_client;
  "lib/printful/setup": typeof lib_printful_setup;
  "lib/printful/webhookRoute": typeof lib_printful_webhookRoute;
  "lib/printful/webhookVerify": typeof lib_printful_webhookVerify;
  "lib/prompts": typeof lib_prompts;
  "lib/providerConfig": typeof lib_providerConfig;
  "lib/r2": typeof lib_r2;
  "lib/redirect": typeof lib_redirect;
  "lib/remixCompare": typeof lib_remixCompare;
  "lib/remixFields": typeof lib_remixFields;
  "lib/remixJudge": typeof lib_remixJudge;
  "lib/remixParts": typeof lib_remixParts;
  "lib/remixTarget": typeof lib_remixTarget;
  "lib/remixWords": typeof lib_remixWords;
  "lib/resize": typeof lib_resize;
  "lib/roleReader": typeof lib_roleReader;
  "lib/salePrep": typeof lib_salePrep;
  "lib/sessions": typeof lib_sessions;
  "lib/shopColors": typeof lib_shopColors;
  "lib/shopFlags": typeof lib_shopFlags;
  "lib/shopLineage": typeof lib_shopLineage;
  "lib/shopProduct": typeof lib_shopProduct;
  "lib/shopify/adminClient": typeof lib_shopify_adminClient;
  "lib/shopify/fulfillmentSync": typeof lib_shopify_fulfillmentSync;
  "lib/shopify/orderQuery": typeof lib_shopify_orderQuery;
  "lib/shopify/productSync": typeof lib_shopify_productSync;
  "lib/shopify/reconcile": typeof lib_shopify_reconcile;
  "lib/shopify/setup": typeof lib_shopify_setup;
  "lib/shopify/webhookRoute": typeof lib_shopify_webhookRoute;
  "lib/shopify/webhookVerify": typeof lib_shopify_webhookVerify;
  "lib/sizes": typeof lib_sizes;
  "lib/social": typeof lib_social;
  "lib/storage": typeof lib_storage;
  "lib/studioRules": typeof lib_studioRules;
  "lib/styleParts": typeof lib_styleParts;
  "lib/trending": typeof lib_trending;
  "lib/upscaleFlow": typeof lib_upscaleFlow;
  "lib/username": typeof lib_username;
  lineage: typeof lineage;
  merch: typeof merch;
  metrics: typeof metrics;
  notifications: typeof notifications;
  orders: typeof orders;
  organizations: typeof organizations;
  payouts: typeof payouts;
  phoneVerification: typeof phoneVerification;
  photos: typeof photos;
  print: typeof print;
  printTools: typeof printTools;
  privacy: typeof privacy;
  provenance: typeof provenance;
  publish: typeof publish;
  remixCheck: typeof remixCheck;
  remixFields: typeof remixFields;
  remixParts: typeof remixParts;
  remixPartsActions: typeof remixPartsActions;
  resources: typeof resources;
  sales: typeof sales;
  "schema/budget": typeof schema_budget;
  "schema/chain": typeof schema_chain;
  "schema/cultremix": typeof schema_cultremix;
  "schema/launch": typeof schema_launch;
  "schema/lineage": typeof schema_lineage;
  "schema/merch": typeof schema_merch;
  "schema/print": typeof schema_print;
  "schema/publish": typeof schema_publish;
  "schema/shop": typeof schema_shop;
  "schema/social": typeof schema_social;
  seed: typeof seed;
  shopify: typeof shopify;
  shopifyFulfill: typeof shopifyFulfill;
  sitemap: typeof sitemap;
  sizing: typeof sizing;
  sms: typeof sms;
  social: typeof social;
  storageMoves: typeof storageMoves;
  studio: typeof studio;
  testHelpers: typeof testHelpers;
  trending: typeof trending;
  upscale: typeof upscale;
  waitlist: typeof waitlist;
  wallets: typeof wallets;
  workEconomics: typeof workEconomics;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
