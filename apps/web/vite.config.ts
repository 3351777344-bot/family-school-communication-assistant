import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/web",
  envDir: false,
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8787" } },
});
