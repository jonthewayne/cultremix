import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins/email-otp";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_DISABLED_PATHS,
  PASSWORD_MIN_LENGTH,
  emailAndPasswordOptions,
  generateJudgePassword,
} from "../../convex/lib/passwordAuth";

const BASE = "http://localhost:3000";

// The same password options convex/auth.ts uses, on an in-memory database, so the
// real Better Auth endpoints answer without a deployment or network.
function testAuth() {
  const sentCodes: Array<string> = [];
  const db: Record<string, Array<unknown>> = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "test-secret-for-unit-tests-only-0123456789abcdef",
    database: memoryAdapter(db as never),
    emailAndPassword: emailAndPasswordOptions,
    disabledPaths: [...PASSWORD_DISABLED_PATHS],
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ otp }) => {
          sentCodes.push(otp);
        },
      }),
    ],
  });
  return { auth, sentCodes };
}

function post(auth: ReturnType<typeof testAuth>["auth"], path: string, body: unknown) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    }),
  );
}

// What convex/judges.ts does: create the user and link a credential account directly.
async function provision(auth: ReturnType<typeof testAuth>["auth"], email: string, password: string) {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ email, name: email, emailVerified: true });
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(password),
  });
  return user;
}

describe("password sign-in for provisioned accounts only", () => {
  it("refuses public password sign-up at the endpoint", async () => {
    const { auth } = testAuth();
    const response = await post(auth, "/sign-up/email", {
      email: "someone@example.com",
      password: "a-long-enough-password",
      name: "someone",
    });
    expect(response.status).toBe(404);
    // Even a server-side call skips the path check and still meets disableSignUp.
    await expect(
      auth.api.signUpEmail({
        body: { email: "someone@example.com", password: "a-long-enough-password", name: "someone" },
      }),
    ).rejects.toThrow(/not enabled/i);
  });

  it("signs in a provisioned account with its password and refuses a wrong one", async () => {
    const { auth } = testAuth();
    const password = generateJudgePassword();
    await provision(auth, "judge@example.com", password);

    const ok = await post(auth, "/sign-in/email", { email: "judge@example.com", password });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("session_token");

    const wrong = await post(auth, "/sign-in/email", { email: "judge@example.com", password: "not-the-password" });
    expect(wrong.status).toBe(401);
  });

  it("gives an email-code member no password to sign in with", async () => {
    const { auth } = testAuth();
    const context = await auth.$context;
    await context.internalAdapter.createUser({ email: "member@example.com", name: "member", emailVerified: true });
    const response = await post(auth, "/sign-in/email", {
      email: "member@example.com",
      password: "guessing-a-password",
    });
    expect(response.status).toBe(401);
  });

  it("closes every password reset path", async () => {
    const { auth } = testAuth();
    for (const path of PASSWORD_DISABLED_PATHS) {
      const response = await post(auth, path, { email: "judge@example.com" });
      expect(response.status, path).toBe(404);
    }
  });

  it("leaves email code sign-in working, including for new members", async () => {
    const { auth, sentCodes } = testAuth();
    const send = await post(auth, "/email-otp/send-verification-otp", {
      email: "new@example.com",
      type: "sign-in",
    });
    expect(send.status).toBe(200);
    expect(sentCodes).toHaveLength(1);
    const signIn = await post(auth, "/sign-in/email-otp", { email: "new@example.com", otp: sentCodes[0] });
    expect(signIn.status).toBe(200);
  });
});

describe("generateJudgePassword", () => {
  it("makes long, readable, distinct passwords", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index++) {
      const password = generateJudgePassword();
      expect(password).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
      expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      seen.add(password);
    }
    expect(seen.size).toBe(50);
  });
});
