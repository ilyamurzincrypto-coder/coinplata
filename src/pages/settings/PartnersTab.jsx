// src/pages/settings/PartnersTab.jsx
// CRUD контрагентов (партнёров) для OTC сделок. Доступен из Settings →
// Партнёры. Все могут читать; manager+ могут создавать; admin/owner —
// редактировать и деактивировать.

import React, { useState, useMemo } from "react";
import { Handshake, UserPlus, Search, X, Edit2, Trash2, Send, Phone } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { usePartners } from "../../store/partners.jsx";
import { useAuth } from "../../store/auth.jsx";

export default function PartnersTab() {
  const { partners, addPartner, updatePartner, removePartner } = usePartners();
  const { isAdmin, isOwner } = useAuth();
  const canEdit = isAdmin || isOwner;
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => {
      const hay = [p.name, p.telegram, p.phone, p.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [partners, query]);

  const editingPartner = editingId ? partners.find((p) => p.id === editingId) : null;

  const handleAdd = async (data) => {
    try {
      await addPartner(data);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
    setShowAdd(false);
  };

  const handleEdit = async (data) => {
    if (!editingId) return;
    try {
      await updatePartner(editingId, data);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
    setEditingId(null);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Деактивировать партнёра "${name}"?`)) return;
    try {
      await removePartner(id);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
  };

  return (
    <div className="divide-y divide-slate-100">
      <section>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-slate-500" />
            <h3 className="text-[15px] font-semibold tracking-tight">Партнёры (OTC)</h3>
            <span className="text-[11px] text-slate-400 ml-1">{partners.length}</span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Добавить партнёра
          </button>
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, telegram, телефону, заметке…"
              className="flex-1 bg-transparent outline-none text-[12.5px] text-slate-900 placeholder:text-slate-400 min-w-0"
            />
            {query && (
              <button onClick={() => setQuery("")} className="p-0.5 rounded hover:bg-slate-200 text-slate-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-slate-400 italic">
              {partners.length === 0
                ? "Нет партнёров. Добавьте первого, чтобы он появился в OTC-форме."
                : "Ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 bg-slate-50/40 rounded-[10px] border border-slate-200 overflow-hidden">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className={`px-3 py-2.5 flex items-center gap-3 ${
                    p.active ? "" : "opacity-60"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-bold text-indigo-700 shrink-0">
                    {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 inline-flex items-center gap-2 flex-wrap">
                      {p.name}
                      {!p.active && (
                        <span className="text-[9px] font-bold text-slate-500 bg-slate-200 px-1 py-0.5 rounded uppercase">
                          deactivated
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 inline-flex items-center gap-2 flex-wrap">
                      {p.telegram && (
                        <span className="inline-flex items-center gap-0.5 text-sky-600">
                          <Send className="w-2.5 h-2.5" />
                          {p.telegram}
                        </span>
                      )}
                      {p.phone && (
                        <span className="inline-flex items-center gap-0.5">
                          <Phone className="w-2.5 h-2.5" />
                          {p.phone}
                        </span>
                      )}
                      {p.note && <span className="italic truncate">{p.note}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingId(p.id)}
                        className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        title="Редактировать"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {p.active && (
                        <button
                          onClick={() => handleDelete(p.id, p.name)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          title="Деактивировать"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <PartnerFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
        title="Новый партнёр"
      />
      <PartnerFormModal
        open={!!editingPartner}
        initial={editingPartner}
        onClose={() => setEditingId(null)}
        onSubmit={handleEdit}
        title="Редактировать партнёра"
      />
    </div>
  );
}

function PartnerFormModal({ open, onClose, onSubmit, initial, title }) {
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  React.useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setTelegram(initial?.telegram || "");
      setPhone(initial?.phone || "");
      setNote(initial?.note || "");
    }
  }, [open, initial]);

  const submit = () => {
    if (!name.trim()) return;
    const tg = telegram.trim();
    onSubmit({
      name: name.trim(),
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      phone: phone.trim(),
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Имя / Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Telegram
            </label>
            <input
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="@username"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Телефон
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7..."
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Описание / каналы / условия..."
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200">
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            name.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}
