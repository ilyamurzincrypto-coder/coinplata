import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/translations.jsx";
import PnLTab from "./PnLTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

describe("PnLTab smoke", () => {
  it("renders net profit row without throwing", () => {
    const ctx = makeLedgerCtx();
    const { container } = render(
      <I18nProvider>
        <PnLTab ctx={ctx} officeFilter="all" formatBase={(n) => `${n}`} baseCurrency="USD" />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/Net Profit|Чистая прибыль|Net kâr/i);
  });
});
