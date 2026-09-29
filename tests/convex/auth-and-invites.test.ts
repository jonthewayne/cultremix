import { afterAll, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  canRunConvexIntegrationTests,
  createTestHelper,
  getTestSecret,
} from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

const timestamp = Date.now();

if (!canRunConvexIntegrationTests()) {
  describe.skip("convex auth guards and invite grants", () => {
    it("requires VITE_CONVEX_URL, CONVEX_DEPLOY_KEY, and TEST_HELPER_SECRET", () => {});
  });
} else {
  describe("convex auth guards and invite grants", () => {
    const t = createTestHelper();
    const seededAuthIds: Array<string> = [];
    const seededOrganizationIds: Array<Id<"organizations">> = [];
    const seededInviteIds: Array<Id<"invites">> = [];

    function authId(label: string) {
      const value = `test-${label}-${timestamp}`;
      seededAuthIds.push(value);
      return value;
    }

    afterAll(async () => {
      for (const inviteId of seededInviteIds) {
        await t.mutation(api.testHelpers.cleanupTestInvite, {
          testSecret: getTestSecret(),
          inviteId,
        });
      }
      for (const organizationId of seededOrganizationIds) {
        await t.mutation(api.testHelpers.cleanupTestOrganization, {
          testSecret: getTestSecret(),
          organizationId,
        });
      }
      for (const id of seededAuthIds) {
        await t.mutation(api.testHelpers.cleanupTestUser, {
          testSecret: getTestSecret(),
          authId: id,
        });
      }
      await t.close();
    });

    it("rejects unauthenticated invite creation", async () => {
      await expect(
        t.mutation(api.invites.createInvite, {
          inviteType: "platform_admin",
          email: `target-${timestamp}@example.com`,
          grants: [{ scopeType: "platform", role: "super_admin_support" }],
        }),
      ).rejects.toThrow(/Not signed in/);
    });

    it("prevents regular users from granting platform roles", async () => {
      const id = authId("regular");
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: id,
        email: `regular-${timestamp}@example.com`,
        platformRole: "user",
      });

      await expect(
        t
          .withIdentity({ subject: id, issuer: "test", name: "Regular" })
          .mutation(api.invites.createInvite, {
            inviteType: "platform_admin",
            email: `target-regular-${timestamp}@example.com`,
            grants: [{ scopeType: "platform", role: "super_admin_owner" }],
          }),
      ).rejects.toThrow();
    });

    it("lets owners create support admin invites", async () => {
      const id = authId("owner");
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: id,
        email: `owner-${timestamp}@example.com`,
        platformRole: "super_admin_owner",
      });

      const inviteId = await t
        .withIdentity({ subject: id, issuer: "test", name: "Owner" })
        .mutation(api.invites.createInvite, {
          inviteType: "platform_admin",
          email: `target-owner-${timestamp}@example.com`,
          grants: [{ scopeType: "platform", role: "super_admin_support" }],
        });

      expect(inviteId).toBeTruthy();
    });

    it("prevents operations admins from demoting platform owners", async () => {
      const ownerAuthId = authId("role-owner");
      const operatorAuthId = authId("role-operator");
      const ownerEmail = `role-owner-${timestamp}@example.test`;
      const ownerUserId = await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: ownerAuthId,
        email: ownerEmail,
        platformRole: "super_admin_owner",
      });
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: operatorAuthId,
        email: `role-operator-${timestamp}@example.test`,
        platformRole: "super_admin_ops",
      });

      await expect(
        t
          .withIdentity({
            subject: operatorAuthId,
            issuer: "test",
            name: "Operator",
          })
          .mutation(api.auth.updatePlatformRole, {
            userId: ownerUserId,
            role: "user",
          }),
      ).rejects.toThrow(/higher platform role/);

      const inviteId = await t
        .withIdentity({
          subject: operatorAuthId,
          issuer: "test",
          name: "Operator",
        })
        .mutation(api.invites.createInvite, {
          inviteType: "platform_admin",
          email: ownerEmail,
          grants: [{ scopeType: "platform", role: "user" }],
        });
      seededInviteIds.push(inviteId);
      await expect(
        t
          .withIdentity({ subject: ownerAuthId, issuer: "test", name: "Owner" })
          .mutation(api.invites.acceptInvite, { inviteId }),
      ).rejects.toThrow(/higher platform role/);
    });

    it("accepts an invite only for the invited email and applies its role", async () => {
      const inviterAuthId = authId("invite-accept-owner");
      const recipientAuthId = authId("invite-accept-recipient");
      const otherAuthId = authId("invite-accept-other");
      const sameEmailAuthId = authId("invite-accept-same-email");
      const recipientEmail = `invite-recipient-${timestamp}@example.test`;
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: inviterAuthId,
        email: `invite-owner-${timestamp}@example.test`,
        platformRole: "super_admin_owner",
      });
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: recipientAuthId,
        email: recipientEmail,
        platformRole: "user",
      });
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: otherAuthId,
        email: `invite-other-${timestamp}@example.test`,
        platformRole: "user",
      });
      await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: sameEmailAuthId,
        email: recipientEmail,
        platformRole: "user",
      });
      const inviteId = await t
        .withIdentity({ subject: inviterAuthId, issuer: "test", name: "Owner" })
        .mutation(api.invites.createInvite, {
          inviteType: "platform_admin",
          email: recipientEmail,
          grants: [{ scopeType: "platform", role: "super_admin_support" }],
        });
      seededInviteIds.push(inviteId);

      const mismatched = await t
        .withIdentity({
          subject: otherAuthId,
          issuer: "test",
          name: "Other",
        })
        .mutation(api.invites.acceptInvite, { inviteId });
      expect(mismatched.success).toBe(false);
      expect(mismatched.error).toBe(
        "Signed-in email does not match this invite",
      );

      const accepted = await t
        .withIdentity({
          subject: recipientAuthId,
          issuer: "test",
          name: "Recipient",
        })
        .mutation(api.invites.acceptInvite, { inviteId });
      expect(accepted).toMatchObject({ success: true, redirectPath: "/admin" });
      const user = await t
        .withIdentity({
          subject: recipientAuthId,
          issuer: "test",
          name: "Recipient",
        })
        .query(api.auth.getCurrentUser, {});
      expect(user?.platformRole).toBe("super_admin_support");

      const replayedByOther = await t
        .withIdentity({ subject: otherAuthId, issuer: "test", name: "Other" })
        .mutation(api.invites.acceptInvite, { inviteId });
      expect(replayedByOther).toMatchObject({
        success: false,
        error: "Signed-in email does not match this invite",
      });
      const replayedBySameEmail = await t
        .withIdentity({
          subject: sameEmailAuthId,
          issuer: "test",
          name: "Other account",
        })
        .mutation(api.invites.acceptInvite, { inviteId });
      expect(replayedBySameEmail).toMatchObject({
        success: false,
        error: "Invite already accepted",
      });
    });

    it("hides magic-link URLs and only lets the matching signed-in email verify an attempt", async () => {
      const email = `email-attempt-${timestamp}@example.test`;
      const attemptId = await t.mutation(
        api.authVerification.createEmailAuthAttempt,
        { email, redirect: "/dashboard" },
      );

      await t.mutation(api.testHelpers.storeTestEmailMagicLinkUrl, {
        testSecret: getTestSecret(),
        email,
        magicLinkUrl: "https://app.example.test/verify?token=bearer-secret",
      });

      const pending = await t.query(
        api.authVerification.getEmailAuthAttemptStatus,
        {
          attemptId,
        },
      );
      expect(pending).not.toBeNull();
      expect(pending).not.toHaveProperty("magicLinkUrl");

      await expect(
        t.mutation(api.authVerification.markEmailAuthAttemptVerified, {
          attemptId,
        }),
      ).rejects.toThrow(/Not signed in/);
      await expect(
        t
          .withIdentity(
            t.newIdentity({ email: `other-${timestamp}@example.test` }),
          )
          .mutation(api.authVerification.markEmailAuthAttemptVerified, {
            attemptId,
          }),
      ).rejects.toThrow(/does not match/);

      await t
        .withIdentity(t.newIdentity({ email }))
        .mutation(api.authVerification.markEmailAuthAttemptVerified, {
          attemptId,
        });
      const verified = await t.query(
        api.authVerification.getEmailAuthAttemptStatus,
        {
          attemptId,
        },
      );
      expect(verified?.status).toBe("verified");
      expect(verified).not.toHaveProperty("magicLinkUrl");
    });

    it("enforces the email-attempt rate limit without sending email", async () => {
      const email = `auth-rate-${timestamp}@example.test`;
      for (let index = 0; index < 20; index += 1) {
        await t.mutation(api.authVerification.createEmailAuthAttempt, {
          email,
          redirect: "/dashboard",
        });
      }

      await expect(
        t.mutation(api.authVerification.createEmailAuthAttempt, {
          email,
          redirect: "/dashboard",
        }),
      ).rejects.toThrow(/Too many attempts/);
    });

    if (process.env.AUTH_PHONE_ENABLED === "true") {
      it("creates phone attempts with console SMS without Telnyx credentials", async () => {
        const attemptId = await t.mutation(
          api.phoneVerification.createPhoneAuthAttempt,
          { phone: "+14155552671", redirect: "/dashboard" },
        );
        const attempt = await t.query(
          api.phoneVerification.getPhoneAuthAttemptStatus,
          { attemptId },
        );

        expect(attempt).toMatchObject({
          _id: attemptId,
          phone: "+14155552671",
          status: "pending",
        });
      });
    } else {
      it("rejects phone attempts while phone authentication is disabled", async () => {
        await expect(
          t.mutation(api.phoneVerification.createPhoneAuthAttempt, {
            phone: "+14155552671",
            redirect: "/dashboard",
          }),
        ).rejects.toThrow(/Phone authentication is not enabled/);
      });
    }

    it("prevents organization admins from granting owner and outsiders from creating scoped resources", async () => {
      const ownerAuthId = authId("organization-owner");
      const adminAuthId = authId("organization-admin");
      const outsiderAuthId = authId("organization-outsider");
      const ownerUserId = await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: ownerAuthId,
        email: `organization-owner-${timestamp}@example.test`,
        platformRole: "user",
      });
      const adminUserId = await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: adminAuthId,
        email: `organization-admin-${timestamp}@example.test`,
        platformRole: "user",
      });
      const outsiderUserId = await t.mutation(api.testHelpers.seedTestUser, {
        testSecret: getTestSecret(),
        authId: outsiderAuthId,
        email: `organization-outsider-${timestamp}@example.test`,
        platformRole: "user",
      });
      const organizationId = await t
        .withIdentity({ subject: ownerAuthId, issuer: "test", name: "Owner" })
        .mutation(api.organizations.createOrganization, {
          name: "Test organization",
          slug: `test-organization-${timestamp}`,
        });
      seededOrganizationIds.push(organizationId);
      await t.mutation(api.testHelpers.seedTestOrganizationMembership, {
        testSecret: getTestSecret(),
        userId: adminUserId,
        organizationId,
        role: "admin",
      });

      await expect(
        t
          .withIdentity({ subject: adminAuthId, issuer: "test", name: "Admin" })
          .mutation(api.organizations.updateMemberRole, {
            organizationId,
            userId: adminUserId,
            role: "owner",
          }),
      ).rejects.toThrow(/owner role/);

      await expect(
        t
          .withIdentity({ subject: adminAuthId, issuer: "test", name: "Admin" })
          .mutation(api.invites.createInvite, {
            inviteType: "organization_admin",
            email: `organization-admin-${timestamp}@example.test`,
            grants: [
              {
                scopeType: "organization",
                scopeId: organizationId,
                role: "owner",
              },
            ],
          }),
      ).rejects.toThrow(/Cannot grant this organization role/);

      const ownerEmail = `organization-owner-${timestamp}@example.test`;
      const downgradeInviteId = await t
        .withIdentity({ subject: adminAuthId, issuer: "test", name: "Admin" })
        .mutation(api.invites.createInvite, {
          inviteType: "organization_admin",
          email: ownerEmail,
          grants: [
            {
              scopeType: "organization",
              scopeId: organizationId,
              role: "admin",
            },
          ],
        });
      seededInviteIds.push(downgradeInviteId);
      await expect(
        t
          .withIdentity({ subject: ownerAuthId, issuer: "test", name: "Owner" })
          .mutation(api.invites.acceptInvite, { inviteId: downgradeInviteId }),
      ).rejects.toThrow(/owner membership/);

      await expect(
        t
          .withIdentity({
            subject: outsiderAuthId,
            issuer: "test",
            name: "Outsider",
          })
          .mutation(api.resources.createResource, {
            organizationId,
            name: "Unauthorized resource",
            slug: `unauthorized-resource-${timestamp}`,
          }),
      ).rejects.toThrow(/organization admin permission/);

      const resourceId = await t
        .withIdentity({ subject: ownerAuthId, issuer: "test", name: "Owner" })
        .mutation(api.resources.createResource, {
          organizationId,
          name: "Authorized resource",
          slug: `authorized-resource-${timestamp}`,
        });
      expect(resourceId).toBeTruthy();
      expect(ownerUserId).toBeTruthy();
      expect(outsiderUserId).toBeTruthy();
    });
  });
}
