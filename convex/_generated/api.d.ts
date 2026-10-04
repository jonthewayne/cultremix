/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authVerification from "../authVerification.js";
import type * as bootstrap from "../bootstrap.js";
import type * as email from "../email.js";
import type * as feed from "../feed.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as imageGen from "../imageGen.js";
import type * as imageNotes from "../imageNotes.js";
import type * as imageSizes from "../imageSizes.js";
import type * as images from "../images.js";
import type * as invites from "../invites.js";
import type * as lib_authEmail from "../lib/authEmail.js";
import type * as lib_authRateLimit from "../lib/authRateLimit.js";
import type * as lib_authVerification from "../lib/authVerification.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_colors from "../lib/colors.js";
import type * as lib_economics from "../lib/economics.js";
import type * as lib_economicsConfigs from "../lib/economicsConfigs.js";
import type * as lib_gridCut from "../lib/gridCut.js";
import type * as lib_imageErrors from "../lib/imageErrors.js";
import type * as lib_imageUrls from "../lib/imageUrls.js";
import type * as lib_lineage from "../lib/lineage.js";
import type * as lib_otp from "../lib/otp.js";
import type * as lib_paging from "../lib/paging.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_pngMeta from "../lib/pngMeta.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_providerConfig from "../lib/providerConfig.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_redirect from "../lib/redirect.js";
import type * as lib_resize from "../lib/resize.js";
import type * as lib_roleReader from "../lib/roleReader.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_sizes from "../lib/sizes.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_studioRules from "../lib/studioRules.js";
import type * as lib_username from "../lib/username.js";
import type * as lineage from "../lineage.js";
import type * as organizations from "../organizations.js";
import type * as phoneVerification from "../phoneVerification.js";
import type * as publish from "../publish.js";
import type * as resources from "../resources.js";
import type * as schema_cultremix from "../schema/cultremix.js";
import type * as schema_lineage from "../schema/lineage.js";
import type * as sizing from "../sizing.js";
import type * as sms from "../sms.js";
import type * as storageMoves from "../storageMoves.js";
import type * as studio from "../studio.js";
import type * as testHelpers from "../testHelpers.js";
import type * as workEconomics from "../workEconomics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authVerification: typeof authVerification;
  bootstrap: typeof bootstrap;
  email: typeof email;
  feed: typeof feed;
  http: typeof http;
  identity: typeof identity;
  imageGen: typeof imageGen;
  imageNotes: typeof imageNotes;
  imageSizes: typeof imageSizes;
  images: typeof images;
  invites: typeof invites;
  "lib/authEmail": typeof lib_authEmail;
  "lib/authRateLimit": typeof lib_authRateLimit;
  "lib/authVerification": typeof lib_authVerification;
  "lib/authz": typeof lib_authz;
  "lib/codes": typeof lib_codes;
  "lib/colors": typeof lib_colors;
  "lib/economics": typeof lib_economics;
  "lib/economicsConfigs": typeof lib_economicsConfigs;
  "lib/gridCut": typeof lib_gridCut;
  "lib/imageErrors": typeof lib_imageErrors;
  "lib/imageUrls": typeof lib_imageUrls;
  "lib/lineage": typeof lib_lineage;
  "lib/otp": typeof lib_otp;
  "lib/paging": typeof lib_paging;
  "lib/permissions": typeof lib_permissions;
  "lib/phone": typeof lib_phone;
  "lib/pngMeta": typeof lib_pngMeta;
  "lib/prompts": typeof lib_prompts;
  "lib/providerConfig": typeof lib_providerConfig;
  "lib/r2": typeof lib_r2;
  "lib/redirect": typeof lib_redirect;
  "lib/resize": typeof lib_resize;
  "lib/roleReader": typeof lib_roleReader;
  "lib/sessions": typeof lib_sessions;
  "lib/sizes": typeof lib_sizes;
  "lib/storage": typeof lib_storage;
  "lib/studioRules": typeof lib_studioRules;
  "lib/username": typeof lib_username;
  lineage: typeof lineage;
  organizations: typeof organizations;
  phoneVerification: typeof phoneVerification;
  publish: typeof publish;
  resources: typeof resources;
  "schema/cultremix": typeof schema_cultremix;
  "schema/lineage": typeof schema_lineage;
  sizing: typeof sizing;
  sms: typeof sms;
  storageMoves: typeof storageMoves;
  studio: typeof studio;
  testHelpers: typeof testHelpers;
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
