import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { resolve } from "path";
import { readFileSync } from "fs";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig(async () => ({
  plugins: [
    react(),
    ...(await electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            emptyOutDir: true,
            rollupOptions: {
              external: ["electron", "electron-store"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            emptyOutDir: false,
            rollupOptions: {
              output: {
                format: "cjs",
                entryFileNames: "preload.js",
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      renderer: {
        resolve: { electron: { type: "esm" } },
      },
    })),
  ],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    open: false,
    hmr: { overlay: false },
  },
}));
