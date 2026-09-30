// The sign-in code email. The code is in the subject so it shows in phone
// notifications, and the body repeats it large, in the CR-number font.

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function authEmailContent(args: {
  appName: string;
  otp: string;
  magicLinkUrl?: string | null;
}) {
  const name = escapeHtml(args.appName);
  const code = escapeHtml(args.otp);
  const magicLink = args.magicLinkUrl
    ? `<p style="margin:16px 0 0;font-size:16px;line-height:1.5;"><a href="${escapeHtml(args.magicLinkUrl)}" style="color:#000000;font-weight:700;">Or sign in with one click</a></p>`
    : "";
  const html = [
    "<!doctype html>",
    '<html><body style="margin:0;padding:0;background:#ffffff;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">',
    '<tr><td style="padding:40px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">',
    `<div style="font-size:14px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;">${name}</div>`,
    '<h1 style="margin:40px 0 0;font-size:36px;line-height:1.05;font-weight:900;letter-spacing:-0.03em;">Your sign-in code</h1>',
    `<div style="margin:24px 0 0;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:44px;font-weight:800;letter-spacing:0.16em;">${code}</div>`,
    `<p style="margin:24px 0 0;font-size:16px;line-height:1.5;color:#404040;">Enter it on the ${name} sign-in page. It works for 10 minutes.</p>`,
    magicLink,
    '<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#737373;">If you didn’t ask for this code, you can ignore this email.</p>',
    "</td></tr></table></body></html>",
  ].join("");
  const text = [
    `Your ${args.appName} sign-in code: ${args.otp}`,
    "",
    `Enter it on the ${args.appName} sign-in page. It works for 10 minutes.`,
    ...(args.magicLinkUrl ? [`Or sign in with one click: ${args.magicLinkUrl}`] : []),
    "",
    "If you didn’t ask for this code, you can ignore this email.",
  ].join("\n");
  return { subject: `${args.otp} is your ${args.appName} code`, html, text };
}
