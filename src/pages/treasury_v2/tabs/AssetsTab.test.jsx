import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/translations.jsx";
import AssetsTab from "./AssetsTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

describe("AssetsTab smoke", () => {
  it("renders asset sections without throwing", () => {
    const ctx = makeLedgerCtx();
    const { container } = render(
      <I18nProvider>
        <AssetsTab ctx={ctx} formatBase={(n) => `${n}`} baseCurrency="USD" onOpenTx={() => {}} />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/1110|Cash/);
  });
});
