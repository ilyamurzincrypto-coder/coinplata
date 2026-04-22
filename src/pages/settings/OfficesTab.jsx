// src/pages/settings/OfficesTab.jsx
// CRUD офисов. Использует useOffices() для state.
// Подсчёт accounts per office — через useAccounts (read-only).

import React, { useState, useMemo } from "react";
import { Building2, Plus, Pencil, Power, RotateCcw } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

// --- Add / Edit modal ---
function OfficeFormModal({ open, office, onClose }) {
  const { t } = useTranslation();
  const { addOffice, updateOffice } = useOffices();
  const { addEntry: logAudit } = useAudit();

  const [name, setName] = useState("");
  const [city, setCity] = useState("");

  React.useEffect(() => {
    if (open) {
      setName(office?.name || "");
      setCity(office?.city || "");
    }
  }, [open, office]);

  const canSubmit = name.trim().length > 0;
  const isEdit = !!office;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (isEdit) {
      updateOffice(office.id, { name: name.trim(), city: city.trim() });
      logAudit({
        action: "update",
        entity: "office",
        entityId: office.id,
        summary: `Edited office ${office.name} → ${name.trim()}`,
      });
    } else {
      const created = addOffice({ name: name.trim(), city: city.trim() });
      if (created) {
        logAudit({
          action: "create",
          entity: "office",
          entityId: created.id,
          summary: `Added office ${created.name}${created.city ? ` (${created.city})` : ""}`,
        });
      }
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t("office_edit_title") : t("office_add_title")}
      width="md"
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("office_name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Istanbul Main"
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("office_city")}
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Istanbul"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {isEdit ? t("save") : t("office_add")}
        </button>
      </div>
    </Modal>
  );
}

// --- Main ---
export default function OfficesTab() {
  const { t } = useTranslation();
  const { offices, closeOffice, reopenOffice } = useOffices();
  const { accounts } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const { isAdmin } = useAuth();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState(null);

  const accountsPerOffice = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => {
      if (!a.active) return;
      map.set(a.officeId, (map.get(a.officeId) || 0) + 1);
    });
    return map;
  }, [accounts]);

  const handleClose = (office) => {
    if (!confirm(t("office_close_confirm"))) return;
    closeOffice(office.id);
    logAudit({
      action: "delete",
      entity: "office",
      entityId: office.id,
      summary: `Closed office ${office.name}`,
    });
  };

  const handleReopen = (office) => {
    reopenOffice(office.id);
    logAudit({
      action: "update",
      entity: "office",
      entityId: office.id,
      summary: `Reopened office ${office.name}`,
    });
  };

  const openEdit = (office) => {
    setEditingOffice(office);
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingOffice(null);
    setModalOpen(true);
  };

  return (
    <div>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{t("offices_title")}</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{t("offices_subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("office_add")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
              <th className="px-5 py-2.5 font-bold">{t("office_name")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_city")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_status")}</th>
              <th className="px-3 py-2.5 font-bold text-right">Accounts</th>
              <th className="px-5 py-2.5 font-bold w-24"></th>
            </tr>
          </thead>
          <tbody>
            {offices.map((o) => {
              const count = accountsPerOffice.get(o.id) || 0;
              const isClosed = o.status === "closed" || o.active === false;
              return (
                <tr
                  key={o.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    isClosed ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-semibold text-slate-900">{o.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{o.city || "—"}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                        isClosed
                          ? "bg-slate-100 text-slate-500"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {isClosed ? t("office_status_closed") : t("office_status_active")}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {count > 0 ? (
                      <span className="font-semibold text-slate-700">{count}</span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">{t("office_no_accounts")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {isAdmin && (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(o)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
                          title={t("edit")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isClosed ? (
                          <button
                            onClick={() => handleReopen(o)}
                            className="p-1.5 rounded-md text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors"
                            title={t("office_reopen")}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClose(o)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title={t("office_close")}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {offices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  No offices
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <OfficeFormModal
        open={modalOpen}
        office={editingOffice}
        onClose={() => {
          setModalOpen(false);
          setEditingOffice(null);
        }}
      />
    </div>
  );
}
