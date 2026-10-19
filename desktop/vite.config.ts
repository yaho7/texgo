import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_RELEASE_TAG": JSON.stringify(process.env.GITHUB_RUN_NUMBER ? `desktop-v${process.env.npm_package_version}-build.${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : "development") },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
  },
});
