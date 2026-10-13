// Отдельный прогон ядра, переданного из CoinPay.
//
// Своя конфигурация, а не общая проектная: ядру не нужен jsdom (это чистые функции без React),
// и оно не должно участвовать в общем прогоне проекта, пока команда не решит его принять.
//
// Перед первым запуском: npm i zod
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
