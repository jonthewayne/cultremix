import { execSync } from "node:child_process";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Which build this is: the git commit it was built from (CULTREMIX_BUILD_ID overrides it). Served
// at /version.json, so open tabs notice a deploy (src/lib/buildVersion.ts).
function buildId() {
  if (process.env.CULTREMIX_BUILD_ID) return process.env.CULTREMIX_BUILD_ID;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return Date.now().toString(36);
  }
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId()),
  },
  server: {
    port: 3000,
    // Localhost only: `tailscale serve --https=3000 3000` holds port 3000 on the
    // tailnet address and proxies https://mighteous.tailb6e2ea.ts.net:3000 here.
    host: "127.0.0.1",
    strictPort: true,
  },
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(),
    react(),
  ],
});
