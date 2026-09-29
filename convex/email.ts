import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { shouldUseConsoleEmailProvider } from "./lib/providerConfig";
import type { DataModel } from "./_generated/dataModel";
import type { GenericCtx } from "@convex-dev/better-auth";

export const resendComponent = new Resend(components.resend, {
  testMode: false,
});

type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

function appName() {
  return process.env.APP_NAME ?? "Starter";
}

function emailFrom() {
  return process.env.AUTH_EMAIL_FROM ?? `Starter <auth@example.com>`;
}

function useConsoleEmailProvider() {
  return shouldUseConsoleEmailProvider(process.env.AUTH_EMAIL_PROVIDER);
}

export async function sendEmail(
  ctx: GenericCtx<DataModel>,
  message: EmailMessage,
) {
  if (useConsoleEmailProvider()) {
    console.log("[email.console]", {
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
    return;
  }

  await resendComponent.sendEmail(ctx as any, {
    from: emailFrom(),
    to: [message.to],
    subject: message.subject,
    html: message.html,
  });
}

export async function sendAuthEmail(
  ctx: GenericCtx<DataModel>,
  args: {
    email: string;
    otp: string;
    magicLinkUrl?: string | null;
  },
) {
  const magicLinkHtml = args.magicLinkUrl
    ? `<p>Or sign in instantly: <a href="${args.magicLinkUrl}">open your magic link</a>.</p>`
    : "";

  await sendEmail(ctx, {
    to: args.email,
    subject: `${appName()} verification code`,
    html: [
      `<p>Your ${appName()} verification code is <strong>${args.otp}</strong>.</p>`,
      magicLinkHtml,
      "<p>This code expires in 10 minutes.</p>",
      "<p>If you did not request this, you can ignore this email.</p>",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export async function sendInviteEmailWithMagicLink(
  ctx: GenericCtx<DataModel>,
  email: string,
  magicLinkUrl: string,
  invite: {
    roleName: string;
    inviterEmail: string;
    note?: string;
  },
) {
  const noteHtml = invite.note
    ? `<p style="color:#52525b;font-style:italic;">${escapeHtml(invite.note)}</p>`
    : "";

  await sendEmail(ctx, {
    to: email,
    subject: `You have been invited to ${appName()}`,
    html: [
      `<p>${escapeHtml(invite.inviterEmail)} invited you to join ${appName()} as <strong>${escapeHtml(invite.roleName)}</strong>.</p>`,
      noteHtml,
      `<p><a href="${magicLinkUrl}">Accept your invite</a></p>`,
      "<p>This link expires automatically. Ask your admin for a new invite if it no longer works.</p>",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export const triggerInviteMagicLink = internalAction({
  args: {
    email: v.string(),
    inviteId: v.id("invites"),
  },
  returns: v.null(),
  handler: async (_ctx, { email, inviteId }) => {
    const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
    const convexSiteUrl = process.env.CONVEX_SITE_URL;
    if (!convexSiteUrl) {
      throw new Error("CONVEX_SITE_URL is required to send invite magic links");
    }

    const response = await fetch(
      `${convexSiteUrl}/api/auth/sign-in/magic-link`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: siteUrl,
        },
        body: JSON.stringify({
          email,
          callbackURL: `/auth/complete?inviteId=${inviteId}`,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `triggerInviteMagicLink failed: ${response.status} ${text.slice(0, 200)}`,
      );
    }

    return null;
  },
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
