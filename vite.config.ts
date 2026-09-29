import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
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
