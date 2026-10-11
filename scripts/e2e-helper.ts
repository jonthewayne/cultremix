// For the signed-in browser test (tests/e2e/run-signed-in.sh), against the dev deployment in
// .env.local. It reads TEST_HELPER_SECRET there and never prints it.
//
//   bun scripts/e2e-helper.ts otp <email>             the newest sign-in code sent to that email
//   bun scripts/e2e-helper.ts role <email> <role>     give a test member a role (e2e+...@example.com only)
//   bun scripts/e2e-helper.ts cleanup <email>         remove a test member and what it made
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const [command, email, role] = process.argv.slice(2);
const url = process.env.VITE_CONVEX_URL;
const testSecret = process.env.TEST_HELPER_SECRET;
if (!url || !testSecret) {
  console.error("Needs VITE_CONVEX_URL and TEST_HELPER_SECRET (in .env.local).");
  process.exit(2);
}
if (!email) {
  console.error("Usage: bun scripts/e2e-helper.ts otp|role|cleanup <email> [role]");
  process.exit(2);
}
const client = new ConvexHttpClient(url);

if (command === "otp") {
  // The code is stored a moment after the email is sent; wait up to 20 seconds.
  for (let i = 0; i < 20; i++) {
    const code = await client.query(api.testHelpers.getTestEmailOtp, { testSecret, email });
    if (code) {
      process.stdout.write(code);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`No sign-in code for ${email}.`);
  process.exit(1);
} else if (command === "role") {
  const platformRole = role as "user" | "super_admin_support" | "super_admin_ops" | "super_admin_owner";
  if (!(await client.mutation(api.testHelpers.setTestUserRole, { testSecret, email, platformRole }))) {
    console.error(`No member with ${email}.`);
    process.exit(1);
  }
} else if (command === "cleanup") {
  const removed = await client.mutation(api.testHelpers.cleanupTestUserByEmail, { testSecret, email });
  console.log(`removed ${removed}`);
} else {
  console.error(`Unknown command ${command}.`);
  process.exit(2);
}

