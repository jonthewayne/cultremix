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
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as invites from "../invites.js";
import type * as lib_authRateLimit from "../lib/authRateLimit.js";
import type * as lib_authVerification from "../lib/authVerification.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_otp from "../lib/otp.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_providerConfig from "../lib/providerConfig.js";
import type * as lib_redirect from "../lib/redirect.js";
import type * as lib_username from "../lib/username.js";
import type * as organizations from "../organizations.js";
import type * as phoneVerification from "../phoneVerification.js";
import type * as resources from "../resources.js";
import type * as schema_cultremix from "../schema/cultremix.js";
import type * as sms from "../sms.js";
import type * as testHelpers from "../testHelpers.js";

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
  http: typeof http;
  identity: typeof identity;
  invites: typeof invites;
  "lib/authRateLimit": typeof lib_authRateLimit;
  "lib/authVerification": typeof lib_authVerification;
  "lib/authz": typeof lib_authz;
  "lib/otp": typeof lib_otp;
  "lib/permissions": typeof lib_permissions;
  "lib/phone": typeof lib_phone;
  "lib/providerConfig": typeof lib_providerConfig;
  "lib/redirect": typeof lib_redirect;
  "lib/username": typeof lib_username;
  organizations: typeof organizations;
  phoneVerification: typeof phoneVerification;
  resources: typeof resources;
  "schema/cultremix": typeof schema_cultremix;
  sms: typeof sms;
  testHelpers: typeof testHelpers;
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
};
