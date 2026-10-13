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
    // Переданный из CoinPay комплект (ledger-from-coinpay/) в общий прогон НЕ входит: он лежит
    // здесь как материал, а его ядру нужен `zod`, которого в проекте пока нет — без исключения
    // он роняет 19 файлов чужого прогона на импорте. Запускать его отдельно:
    //   npm i zod && npx vitest run --config ledger-from-coinpay/core/vitest.config.js
    exclude: ["**/node_modules/**", "**/dist/**", "ledger-from-coinpay/**"],
  },
});
