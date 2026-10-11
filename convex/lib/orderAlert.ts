// When an order needs a person (convex/orderAlerts.ts): what to call the trouble, and the email to
// the owner. Pure, so it's tested without sending anything.

export const STUCK_STATES = ["needs_attention", "manual_required", "on_hold"] as const;
export type StuckState = (typeof STUCK_STATES)[number];

// What went wrong, in words: the order's own reason, else what the state means.
export function stuckReason(state: StuckState, reason: string | undefined) {
  if (reason?.trim()) return reason.trim();
  if (state === "on_hold") return "Printful put it on hold. Its dashboard says why (often billing or the address).";
  if (state === "manual_required") return "It needs to be made in Printful by hand.";
  return "It needs a look before it can go to print.";
}

// The same trouble alerts once; a new state or reason alerts again.
export function alertKey(state: StuckState, reason: string | undefined) {
  return `${state}:${stuckReason(state, reason)}`.slice(0, 600);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function orderAlertEmailContent(args: { orderName: string; reason: string; siteUrl: string }) {
  const site = args.siteUrl.replace(/\/+$/u, "");
  const orders = `${site}/admin/orders`;
  const subject = `Order ${args.orderName} needs you`;
  const lead = `Order ${args.orderName} can't go on by itself: ${args.reason}`;
  const text = [lead, "", `Admin, Orders: ${orders}`].join("\n");
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">',
    '<p style="margin:0 0 24px;font-size:13px;font-weight:900;letter-spacing:0.2em;">CULTREMIX</p>',
    '<p style="margin:0 0 24px;font-size:18px;line-height:1.4;font-weight:700;">' + escapeHtml(lead) + "</p>",
    '<p style="margin:0;"><a href="' + escapeHtml(orders) + '" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 20px;border-radius:12px;">Admin, Orders</a></p>',
    "</div></body></html>",
  ].join("");
  return { subject, text, html };
}
