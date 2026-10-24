import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// `npm run dev:test` runs with a separate throwaway database, so automated tests never touch your own local data.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(mode === "isolated" ? { persistState: { path: ".wrangler/test-state" } } : {}),
  ],
}));
