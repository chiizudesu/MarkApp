import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** Writing-app chrome: cool neutrals aligned with `editor.css` accents (#3b82f6 / #60a5fa). */
export const system = createSystem(
  defaultConfig,
  defineConfig({
    theme: {
      tokens: {
        fonts: {
          body: {
            value:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
          },
          heading: {
            value:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
          },
        },
        colors: {
          markapp: {
            50: { value: "#f4f7fb" },
            100: { value: "#e8eef6" },
            200: { value: "#d5e0ed" },
            300: { value: "#b8c9db" },
            400: { value: "#8fa8c4" },
            500: { value: "#6b8aaf" },
            600: { value: "#4d6f96" },
            700: { value: "#3e5a7a" },
            800: { value: "#354c65" },
            900: { value: "#2f4255" },
            950: { value: "#1e2a37" },
          },
        },
        radii: {
          markapp: { value: "0.375rem" },
        },
      },
    },
  }),
);
