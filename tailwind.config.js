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
        // ── Редизайн rondesignlab (2026-08): тёплый крем, тонкие цифры,
        //    круглые формы, тёмные секции. Источник истины — design/reference.html.
        //    Общие токены (bg/surface/ink/muted) перекрашены в тёплую палитру —
        //    это глобально теплит всё приложение. Эмеральд `accent` пока живёт
        //    (его роль расщепляется на dark-CTA / lime-ok / blue-accent по экранам).

        // ── Surfaces ─────────────────────────────────────────────────
        bg:              "#F1EBDE",  // фон-крем страниц
        "cream":         "#F1EBDE",  // алиас фона (для явности в новых компонентах)
        "cream-2":       "#EAE3D3",  // крем-2 (утопленные/zebra на креме)
        surface:         "#FDFCF8",  // карточки — тёплый off-white
        "card":          "#FDFCF8",  // алиас карточки
        "surface-soft":  "#EAE3D3",  // hover на строках, zebra
        "surface-sunk":  "#EDE6D6",  // inputs в покое
        "surface-dark":  "#17150F",  // тёмные секции/hero
        "dark":          "#17150F",  // тёмная секция
        "dark-2":        "#23211A",  // тёмная карточка (строки в тёмной секции)
        "dark-3":        "#2B2820",  // тёмная-3

        // ── Borders / линии ───────────────────────────────────────────
        border:        "#E2DBCB",   // линия
        "border-soft": "#EAE3D3",   // мягче
        "line":        "#E2DBCB",
        "line-2":      "#CFC8B8",

        // ── Text ─────────────────────────────────────────────────────
        ink:          "#1A1915",   // чернила / кнопки
        "ink-soft":   "#3A362B",   // secondary
        muted:        "#8A8577",   // вторичный, labels
        "muted-soft": "#A39D8C",   // третичный, дробная часть
        "faint":      "#A39D8C",   // футноты

        // ── Accent — репойнт в монохром-ink + лайм (эмеральд убит) ─────
        // bg-accent → тёмная кнопка (как CTA макета); text-accent → ink-ссылка;
        // accent.glow (на тёмном фоне) → лайм; soft/bg → тёплые нейтрали.
        accent: {
          DEFAULT: "#1A1915",   // ink
          hover:   "#000000",
          glow:    "#C8D96F",   // лайм — точки/текст на тёмном
          soft:    "#EAE3D3",   // badge-подложка (крем-2)
          bg:      "#EDE6D6",   // subtle tag bg
        },

        // ── Override Tailwind emerald-* → тёплая лайм/олив-шкала ───────
        // Убивает 125 литеральных emerald-* по всему репо без правки файлов:
        // *-600/700 (текст на светлом) → тёмный олив (читаемо, без «кислоты»);
        // *-400 (на тёмном фоне) → лайм; *-50/100 (подложки бейджей) → крем-лайм.
        emerald: {
          50:  "#EFF2E1",
          100: "#E7EAD5",
          200: "#DDE3C0",
          300: "#C8D96F",
          400: "#C8D96F",
          500: "#AFC257",
          600: "#3E4A16",
          700: "#2E3312",
          800: "#242A0E",
          900: "#1B200A",
        },
        // green/teal — тот же тёплый олив/лайм (убивает зелёные бейджи/кнопки).
        green: {
          50:  "#EFF2E1",
          100: "#E7EAD5",
          200: "#DDE3C0",
          300: "#C8D96F",
          400: "#C8D96F",
          500: "#AFC257",
          600: "#3E4A16",
          700: "#2E3312",
          800: "#242A0E",
          900: "#1B200A",
        },
        teal: {
          50:  "#EFF2E1",
          100: "#E7EAD5",
          200: "#DDE3C0",
          300: "#C8D96F",
          400: "#C8D96F",
          500: "#AFC257",
          600: "#3E4A16",
          700: "#2E3312",
          800: "#242A0E",
          900: "#1B200A",
        },
        // indigo/violet — репойнт в приглушённый сине-серый акцент (эталон).
        indigo: {
          50:  "#EEF1F5",
          100: "#E9EDF2",
          200: "#D4DAE3",
          300: "#B4BECD",
          400: "#93A0B5",
          500: "#76869E",
          600: "#66768E",
          700: "#55637A",
          800: "#434F62",
          900: "#333C4B",
        },
        violet: {
          50:  "#EEF1F5",
          100: "#E9EDF2",
          200: "#D4DAE3",
          300: "#B4BECD",
          400: "#93A0B5",
          500: "#76869E",
          600: "#66768E",
          700: "#55637A",
          800: "#434F62",
          900: "#333C4B",
        },

        // ── Новая палитра ролей (эталон) ─────────────────────────────
        // Акцент-блок — сине-серый градиент (см. backgroundImage.accent-block)
        "blue":       "#93A0B5",
        "blue-2":     "#76869E",
        "blue-ink":   "#E9EDF2",   // текст на акцент-блоке
        "blue-soft":  "#D4DAE3",   // вторичный текст на акцент-блоке
        // Действие / ок — лайм (забирает роль success/«Принять»)
        "lime":       "#C8D96F",
        "lime-ink":   "#2E3312",
        // Внимание — оранжевый
        "orange":     "#E8622C",
        "orange-bg":  "#F6E3D3",
        "orange-ink": "#8A4A22",

        // ── Status ───────────────────────────────────────────────────
        success:        "#3E4A16",  // тёплый олив (был forest-green)
        "success-soft": "#EFF2E1",
        danger:         "#C43A2B",  // ошибка (эталон)
        "danger-soft":  "#F4DAD4",
        "red":          "#C43A2B",
        "red-bg":       "#F4DAD4",
        warning:        "#B45309",
        "warning-soft": "#FEF3C7",
        info:           "#3B82F6",
        "info-soft":    "#DBEAFE",

        // ── Favorite rate-card backgrounds (Шаг 4.12) ────────────────
        "fav-bg":       "#FFFCEF",
        "fav-bg-hover": "#FFF8DE",
        "fav-divider":  "#F5EBC8",
      },

      backgroundImage: {
        // Тёплые радиальные свечения фонов (эталон). Тени НЕ используются.
        "frame-glow":
          "radial-gradient(900px 420px at 78% -10%, rgba(238,178,92,.28), transparent 62%), radial-gradient(700px 380px at 8% 108%, rgba(238,178,92,.14), transparent 60%)",
        "hero-glow": "radial-gradient(360px 220px at 90% -30%, rgba(232,98,44,.28), transparent 65%)",
        "deals-glow": "radial-gradient(500px 260px at 6% -30%, rgba(238,178,92,.10), transparent 60%)",
        "accent-block":
          "radial-gradient(220px 160px at 88% -20%, rgba(240,196,130,.55), transparent 70%), linear-gradient(148deg, #93A0B5, #76869E)",
      },

      borderRadius: {
        card:      "16px",  // legacy карточки (мигрируют на card-2 по-экранно)
        "card-lg": "20px",  // hero блоки (legacy)
        // Редизайн-радиусы (эталон): экран 32, карточка 24, вложенная 18, инпут 14
        "screen":  "32px",
        "card-2":  "24px",
        "card-sm": "18px",
        "input-2": "14px",
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
          "Onest",
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
