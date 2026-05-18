/** @type {import('tailwindcss').Config} */
//
// COINPLATA Design System — гибрид Stripe Dashboard / Modern Treasury /
// Apple / Toss. B2B inhouse tool для оператора крипто-обменника.
//
// Принципы:
//   • Тёплый off-white фон, монохром + один зелёный (emerald)
//   • Без border/shadow на карточках в покое — тени только на hover
//   • Все числа — JetBrains Mono с tabular numerals
//   • Body — Pretendard (variable, кириллица + Hangul)
//   • Anchor CTA «Новая сделка» — emerald glow shadow
//   • Эмеральд встречается СКУПО — 3-4 места на экран максимум
//
// Старые tailwind utilities (slate-*, gray-*, emerald-* и т.д.) продолжают
// работать — система мерджится с дефолтами, ничего не ломается.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ── Surfaces ─────────────────────────────────────────────────
        bg:              "#FAFAF7",  // тёплый off-white — фон страниц (Apple Notes vibe)
        surface:         "#FFFFFF",  // белые контейнеры (карточки, modals)
        "surface-soft":  "#F4F4F0",  // hover на строках, zebra, sunk сегменты
        "surface-sunk":  "#F0F0EC",  // inputs в покое, утопленные states
        "surface-dark":  "#0F1216",  // тёмный navbar и hero блоки

        // ── Borders — используются скупо ──────────────────────────────
        border:        "#ECECE6",   // едва видимая, inputs + редкие dividers
        "border-soft": "#F4F4F0",   // ещё мягче, dashed-разделители в списках

        // ── Text ─────────────────────────────────────────────────────
        ink:          "#131416",   // основной текст (не #000)
        "ink-soft":   "#3C3F44",   // secondary headings
        muted:        "#8B8F95",   // вторичный, labels
        "muted-soft": "#B5B9BF",   // третичный, captions, дробная часть, zero

        // ── Accent — эмеральд (anchor CTA) ────────────────────────────
        accent: {
          DEFAULT: "#10B981",
          hover:   "#0EA572",
          glow:    "#34D399",      // светящиеся точки, текст на dark-bg
          soft:    "#D1FAE5",      // success-badge bg
          bg:      "#ECFDF5",      // subtle filled (теги ALL OFFICES)
        },

        // ── Status ───────────────────────────────────────────────────
        success:        "#047857",
        "success-soft": "#D1FAE5",
        danger:         "#B91C1C",
        "danger-soft":  "#FEE2E2",
        warning:        "#B45309",
        "warning-soft": "#FEF3C7",
        info:           "#3B82F6",
        "info-soft":    "#DBEAFE",

        // ── Favorite rate-card backgrounds (Шаг 4.12) ────────────────
        "fav-bg":       "#FFFCEF",
        "fav-bg-hover": "#FFF8DE",
        "fav-divider":  "#F5EBC8",
      },

      borderRadius: {
        card:      "16px",  // основные карточки/контейнеры
        "card-lg": "20px",  // hero блоки
        button:    "10px",  // кнопки
        input:     "10px",
        badge:     "6px",   // status badges, network теги
        pill:      "999px", // tabs, filters
      },

      boxShadow: {
        // Карточки в покое — БЕЗ теней. Тени только на hover/active/CTA.
        "card-hover":  "0 4px 16px -2px rgba(19,20,22,0.06), 0 2px 6px -1px rgba(19,20,22,0.04)",
        "card-active": "0 8px 24px -4px rgba(19,20,22,0.08), 0 4px 10px -2px rgba(19,20,22,0.05)",

        // Anchor CTA — emerald glow
        "cta-glow":       "0 4px 12px -2px rgba(16,185,129,0.35), 0 0 0 0 rgba(16,185,129,0)",
        "cta-glow-hover": "0 6px 16px -2px rgba(16,185,129,0.45), 0 0 0 1px rgba(16,185,129,0.3)",
        "cta-glow-big":   "0 8px 24px -4px rgba(16,185,129,0.5), 0 0 0 1px rgba(16,185,129,0.3)",

        // Inputs focus
        "input-focus": "0 0 0 3px rgba(16,185,129,0.12)",

        // Modals
        modal: "0 24px 48px -12px rgba(19,20,22,0.18), 0 8px 16px -4px rgba(19,20,22,0.08)",

        // Segmented control active item
        seg: "0 1px 2px rgba(19,20,22,0.06)",
      },

      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "monospace",
        ],
      },

      fontSize: {
        // Display (крупные числа и hero заголовки)
        "display-xl": ["44px", { lineHeight: "48px", letterSpacing: "-0.025em", fontWeight: "700" }],
        "display-lg": ["32px", { lineHeight: "36px", letterSpacing: "-0.02em",  fontWeight: "700" }],
        "display":    ["26px", { lineHeight: "30px", letterSpacing: "-0.02em",  fontWeight: "700" }],

        // Page/section headings
        "h1":         ["28px", { lineHeight: "32px", letterSpacing: "-0.02em",  fontWeight: "700" }],
        "h2":         ["18px", { lineHeight: "24px", letterSpacing: "-0.01em",  fontWeight: "600" }],
        "h3":         ["15px", { lineHeight: "20px", letterSpacing: "-0.005em", fontWeight: "600" }],

        // Body
        "body":       ["14px", { lineHeight: "20px" }],
        "body-sm":    ["13px", { lineHeight: "18px" }],
        "caption":    ["12px", { lineHeight: "16px" }],
        "micro":      ["11px", { lineHeight: "14px", letterSpacing: "0.04em", fontWeight: "600" }],
      },

      spacing: {
        "page-x":  "28px",  // горизонтальный padding страниц
        "section": "28px",  // вертикальный отступ между секциями
        "card":    "20px",  // padding внутри карточки
        "card-lg": "28px",  // padding hero карточек
      },

      transitionTimingFunction: {
        apple: "cubic-bezier(0.4, 0.0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
