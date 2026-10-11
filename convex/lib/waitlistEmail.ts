// The early-access email (convex/waitlist.ts sends it when an admin presses Email them): the one
// note "Buying opens soon" promised. One per address, naming each design they asked about that can
// be bought now, with a link to each. Pure, so it's tested without sending anything.

export type OpenDesign = { title?: string; cr: string };

function name(design: OpenDesign) {
  return design.title ? `${design.title} (CR ${design.cr})` : `CR ${design.cr}`;
}

function listOf(names: Array<string>) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function waitlistEmailContent(args: { designs: Array<OpenDesign>; siteUrl: string }) {
  const site = args.siteUrl.replace(/\/+$/u, "");
  const one = args.designs.length === 1;
  const names = args.designs.map(name);
  const subject = one ? `You can buy ${names[0]} now` : "Designs you asked about can be bought now";
  const lead = `You asked to hear when you could buy ${listOf(names)}. ${one ? "It's" : "They're"} ready now.`;
  const links = args.designs.map((design) => ({ label: name(design), url: `${site}/cr/${design.cr}` }));
  const after = "This is the one email you asked for. We won't write to you about these designs again.";
  const text = [lead, "", ...links.map((link) => `${link.label}: ${link.url}`), "", after].join("\n");
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">',
    '<p style="margin:0 0 24px;font-size:13px;font-weight:900;letter-spacing:0.2em;">CULTREMIX</p>',
    '<p style="margin:0 0 24px;font-size:18px;line-height:1.4;font-weight:700;">' + escapeHtml(lead) + "</p>",
    ...links.map(
      (link) =>
        '<p style="margin:0 0 12px;"><a href="' +
        escapeHtml(link.url) +
        '" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 20px;border-radius:12px;">' +
        escapeHtml(one ? "Buy it" : link.label) +
        "</a></p>",
    ),
    '<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#737373;">' + escapeHtml(after) + "</p>",
    "</div></body></html>",
  ].join("");
  return { subject, text, html };
}
