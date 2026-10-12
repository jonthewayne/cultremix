import { api } from "../../convex/_generated/api";
import type { ConvexReactClient } from "convex/react";

// Sends errors that happen in this browser to convex/clientErrors.ts, so Admin, Overview shows what
// broke and where. At most five a page load, each error once. Nothing personal: the message, the
// stack, the page's path (never its query), and the browser. It listens from the moment this module
// loads, so an error before the page is ready waits and goes once the Convex client is there.

const MAX_PER_LOAD = 5;
let client: ConvexReactClient | null = null;
let sent = 0;
const seen = new Set<string>();
type Report = { message: string; stack?: string; path: string; userAgent: string; source: ErrorSource };
const waiting: Array<Report> = [];

function send(convex: ConvexReactClient, report: Report) {
  void convex.mutation(api.clientErrors.report, report).catch(() => undefined);
}

export type ErrorSource = "window" | "promise" | "page";

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? error.name + ": " : "";
    return { message: name + error.message, stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

export function reportClientError(error: unknown, source: ErrorSource) {
  if (typeof window === "undefined" || sent >= MAX_PER_LOAD) return;
  const { message, stack } = describeError(error);
  if (!message) return;
  const path = window.location.pathname;
  const key = message + "|" + path;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;
  const report: Report = { message: message.slice(0, 1000), stack: stack?.slice(0, 4000), path, userAgent: navigator.userAgent.slice(0, 300), source };
  if (client) send(client, report);
  else waiting.push(report);
}

// Listening starts as soon as this module loads in a browser.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message, "window"));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "promise"));
}

// Once, from the root component, with the Convex client: what waited goes now.
export function installClientErrorReporting(convex: ConvexReactClient) {
  if (typeof window === "undefined" || client) return;
  client = convex;
  for (const report of waiting.splice(0)) send(convex, report);
}
