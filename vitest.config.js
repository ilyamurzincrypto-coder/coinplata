// vitest.config.js — separate config так как vite.config.js не имеет test
// блока. Используется для component tests с jsdom + testing-library.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.js"],
  },
});
