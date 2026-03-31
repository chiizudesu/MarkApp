import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as {
  version: string;
};

export default defineConfig(async () => ({
  /** Required for Electron `loadFile(dist/index.html)`: absolute `/assets/...` breaks on file://. */
  base: "./",
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
    alias: { "@": resolve(root, "src") },
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
    /** Helps dev HMR / asset URLs when `base` is relative (Electron-style output). */
    origin: "http://localhost:5173",
  },
}));
