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

  it("the first card is open by default; expanding another card reveals its 'what' and bullets", () => {
    render(<InfoPage />);
    // first card open by default → its what + first bullet visible
    expect(screen.getByText(INFO_SECTIONS[0].what)).toBeInTheDocument();
    expect(screen.getByText(INFO_SECTIONS[0].can[0])).toBeInTheDocument();
    // a later card is collapsed → expand it
    const second = INFO_SECTIONS[1];
    expect(screen.queryByText(second.what)).toBeNull();
    fireEvent.click(screen.getByText(second.title));
    expect(screen.getByText(second.what)).toBeInTheDocument();
    expect(screen.getByText(second.can[0])).toBeInTheDocument();
  });
});
