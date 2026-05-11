import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import InfoPage from "./InfoPage.jsx";
import { INFO_SECTIONS } from "./info/content.js";

describe("InfoPage", () => {
  it("renders the heading and every section's title", () => {
    render(<InfoPage />);
    expect(screen.getByText("Справка")).toBeInTheDocument();
    for (const s of INFO_SECTIONS) expect(screen.getByText(s.title)).toBeInTheDocument();
  });

  it("the first card is open by default and shows 'Как работает', the first how-step, and the first example title + its journal account", () => {
    const { container } = render(<InfoPage />);
    const first = INFO_SECTIONS[0];
    expect(screen.getAllByText("Как работает:").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain(first.how[0]);
    expect(container.textContent).toContain(first.examples[0].title);
    const j = first.examples[0].journal;
    if (j && j.length) expect(container.textContent).toContain(j[0].account);
  });

  it("expanding a collapsed card reveals its 'what', bullets, and how", () => {
    render(<InfoPage />);
    const second = INFO_SECTIONS[1];
    expect(screen.queryByText(second.what)).toBeNull();
    fireEvent.click(screen.getByText(second.title));
    expect(screen.getByText(second.what)).toBeInTheDocument();
    expect(screen.getByText(second.can[0])).toBeInTheDocument();
    expect(screen.getByText(second.how[0])).toBeInTheDocument();
  });
});
