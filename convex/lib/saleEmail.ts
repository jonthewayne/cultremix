// The "someone bought your design" email (convex/saleEmails.ts sends it). One per recipient per order,
// listing each design they share in with what it earns them. Plain words, a link to Earnings, and a
// link to turn these off in Settings. Pure, so it's tested without sending anything.

export type SoldLine = {
  // Absent for a design that isn't public (kept just for its creator): it's never named.
  title?: string;
  cr?: string;
  cents: number;
  units: number;
  // The recipient's own design it was remixed from, when the design sold is someone else's remix.
  from?: { title?: string; cr: string };
};

function money(cents: number) {
  return "$" + (cents / 100).toFixed(2);
}

function name(design: { title?: string; cr: string }) {
  return design.title ? design.title + " (CR " + design.cr + ")" : "CR " + design.cr;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// What sold: its title and number, or for a kept design (no public number), only that it's a
// private remix of the recipient's design.
function what(line: SoldLine) {
  if (line.cr) {
    const design = name({ title: line.title, cr: line.cr });
    return line.from ? design + ", a remix of your " + name(line.from) : design;
  }
  return line.from ? "a private remix of your " + name(line.from) : "a private design you share in";
}

function sentence(line: SoldLine) {
  const count = line.units > 1 ? line.units + " of " : "";
  return "Someone bought " + count + what(line) + ". You earn " + money(line.cents) + ".";
}

export function saleEmailContent(args: { lines: Array<SoldLine>; siteUrl: string }) {
  const site = args.siteUrl.replace(/\/+$/u, "");
  const total = args.lines.reduce((sum, line) => sum + line.cents, 0);
  const first = args.lines[0];
  const subject =
    args.lines.length === 1 && first
      ? "Someone bought " + (first.cr ? name({ title: first.title, cr: first.cr }) : what(first))
      : "Someone bought designs you share in";
  const sentences = args.lines.map(sentence);
  const after =
    "Your share becomes payable 30 days after the order ships, once returns have had time to come in." +
    (args.lines.length > 1 ? " In all, you earn " + money(total) + " from this order." : "");
  const earnings = site + "/me/earnings";
  const settings = site + "/settings";
  const text = [
    ...sentences,
    "",
    after,
    "",
    "Your earnings: " + earnings,
    "",
    "You get these because you share in sales of your designs. Turn them off in Settings: " + settings,
  ].join("\n");
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">',
    '<p style="margin:0 0 24px;font-size:13px;font-weight:900;letter-spacing:0.2em;">CULTREMIX</p>',
    ...sentences.map((s) => '<p style="margin:0 0 12px;font-size:18px;line-height:1.4;font-weight:700;">' + escapeHtml(s) + "</p>"),
    '<p style="margin:16px 0 24px;font-size:15px;line-height:1.5;color:#404040;">' + escapeHtml(after) + "</p>",
    '<p style="margin:0 0 32px;"><a href="' + escapeHtml(earnings) + '" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 20px;border-radius:12px;">Your earnings</a></p>',
    '<p style="margin:0;font-size:12px;line-height:1.5;color:#737373;">You get these because you share in sales of your designs. <a href="' + escapeHtml(settings) + '" style="color:#737373;">Turn them off in Settings</a>.</p>',
    "</div></body></html>",
  ].join("");
  return { subject, text, html };
}

