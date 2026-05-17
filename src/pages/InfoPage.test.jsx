import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import InfoPage from "./InfoPage.jsx";
import { INFO_SECTIONS } from "./info/content.js";

describe("InfoPage", () => {
  it("renders hero heading, search field and every section's title in TOC", () => {
    render(<InfoPage />);
    // Hero — приветствие (одно из 4 вариантов по времени дня)
    expect(screen.getByText(/Добр|Доброй/)).toBeInTheDocument();
    // Search input
    expect(screen.getByPlaceholderText(/Поиск по справке/)).toBeInTheDocument();
    // Каждый раздел встречается минимум 1 раз (TOC sidebar + card header) —
    // используем getAllByText т.к. title дублируется в TOC и в карточке
    for (const s of INFO_SECTIONS) {
      const matches = screen.getAllByText(s.title);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("the first card is open by default and shows section content", () => {
    const { container } = render(<InfoPage />);
    const first = INFO_SECTIONS[0];
    // Раскрытая первая секция: видны её bullets и examples (по дефолту таб «Кратко»).
    // Можем проверить наличие текста из can[] (он показывается в Кратко-табе).
    if (first.can && first.can.length) {
      expect(container.textContent).toContain(first.can[0]);
    }
  });

  it("search filters sections by text and shows empty state for non-matches", () => {
    render(<InfoPage />);
    const input = screen.getByPlaceholderText(/Поиск по справке/);
    fireEvent.change(input, { target: { value: "ZZZ_NOSUCHTHING_QQQ" } });
    expect(screen.getByText(/Ничего не найдено/)).toBeInTheDocument();
  });

  it("search query highlights matches in section content", () => {
    render(<InfoPage />);
    const input = screen.getByPlaceholderText(/Поиск по справке/);
    // Ищем по слову которое заведомо есть в первом разделе (его title)
    const first = INFO_SECTIONS[0];
    const firstWord = (first.title || "").split(" ")[0];
    if (firstWord) {
      fireEvent.change(input, { target: { value: firstWord } });
      // <mark> добавляется на совпадения
      const marks = document.querySelectorAll("mark");
      expect(marks.length).toBeGreaterThan(0);
    }
  });
});
