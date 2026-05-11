import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const emitToast = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToast(...a) }));
const rpcUpd = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcUpdateTxMetadataV2: (...a) => rpcUpd(...a) }));

import EditTxNoteModal from "./EditTxNoteModal.jsx";

describe("EditTxNoteModal", () => {
  it("pre-fills the current comment, sends a metadata patch on save, toasts success", async () => {
    rpcUpd.mockReset(); emitToast.mockReset();
    rpcUpd.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<EditTxNoteModal tx={{ id: "tx-1", description: "deal #42", metadata: { comment: "old note" } }} onClose={onClose} />);
    const ta = screen.getByPlaceholderText("trv2_tx_note_ph");
    expect(ta.value).toBe("old note");
    fireEvent.change(ta, { target: { value: "  new note  " } });
    fireEvent.click(screen.getByText("trv2_tx_note_save"));
    await waitFor(() => expect(rpcUpd).toHaveBeenCalledWith({ txId: "tx-1", patch: { comment: "new note" } }));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("success", "trv2_tx_note_saved"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("starts empty when the tx has no comment; 42501 → forbidden toast", async () => {
    rpcUpd.mockReset(); emitToast.mockReset();
    rpcUpd.mockRejectedValue(new Error("permission denied (42501)"));
    render(<EditTxNoteModal tx={{ id: "tx-2", description: "manual" }} onClose={() => {}} />);
    expect(screen.getByPlaceholderText("trv2_tx_note_ph").value).toBe("");
    fireEvent.change(screen.getByPlaceholderText("trv2_tx_note_ph"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("trv2_tx_note_save"));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("error", "trv2_pm_err_forbidden"));
  });
});
