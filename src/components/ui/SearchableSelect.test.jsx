import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SearchableSelect from "./SearchableSelect.jsx";

const OPTS = [
  { id: "c1", name: "Иван Петров" },
  { id: "c2", name: "ООО Ромашка" },
  { id: "c3", name: "Алексей Сидоров" },
];

describe("SearchableSelect", () => {
  it("renders placeholder when nothing selected and the selected name otherwise", () => {
    const { rerender } = render(<SearchableSelect value={null} onChange={() => {}} options={OPTS} placeholder="Выбрать" />);
    expect(screen.getByRole("button", { name: /Выбрать/ })).toBeInTheDocument();
    rerender(<SearchableSelect value="c2" onChange={() => {}} options={OPTS} placeholder="Выбрать" />);
    expect(screen.getByRole("button", { name: /ООО Ромашка/ })).toBeInTheDocument();
  });

  it("opens on click, filters by query, and fires onChange when an option is picked", () => {
    const onChange = vi.fn();
    render(<SearchableSelect value={null} onChange={onChange} options={OPTS} placeholder="Выбрать" />);
    fireEvent.click(screen.getByRole("button"));
    // All options visible right after open.
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("ООО Ромашка")).toBeInTheDocument();
    expect(screen.getByText("Алексей Сидоров")).toBeInTheDocument();
    // Type to filter.
    fireEvent.change(screen.getByPlaceholderText("Поиск…"), { target: { value: "ром" } });
    expect(screen.queryByText("Иван Петров")).toBeNull();
    expect(screen.getByText("ООО Ромашка")).toBeInTheDocument();
    // Pick.
    fireEvent.click(screen.getByText("ООО Ромашка"));
    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("Enter on the search input picks the first filtered option", () => {
    const onChange = vi.fn();
    render(<SearchableSelect value={null} onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByPlaceholderText("Поиск…");
    fireEvent.change(input, { target: { value: "алекс" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c3");
  });

  it("shows emptyText when no options match", () => {
    render(<SearchableSelect value={null} onChange={() => {}} options={OPTS} emptyText="Пусто" />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Поиск…"), { target: { value: "zzz" } });
    expect(screen.getByText("Пусто")).toBeInTheDocument();
  });

  it("does not open when disabled", () => {
    render(<SearchableSelect value={null} onChange={() => {}} options={OPTS} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByPlaceholderText("Поиск…")).toBeNull();
  });
});
