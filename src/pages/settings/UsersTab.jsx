// src/pages/settings/UsersTab.jsx
// Таблица пользователей с Active/Inactive фильтром, кнопками deactivate/reactivate,
// и модалкой создания нового (с показом сгенерированного пароля один раз).

import React, { useState, useMemo } from "react";
import { UserPlus, ShieldCheck, Users as UsersIcon, Copy, Check, User as UserIcon } from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import Modal from "../../components/ui/Modal.jsx";
import { useAuth, ROLES, ROLE_IDS } from "../../store/auth.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

export default function UsersTab() {
  const { t } = useTranslation();
  const { users, updateUserRole, updateUser, deactivateUser, reactivateUser, isAdmin } = useAuth();
  const { offices } = useOffices();
  const { addEntry: logAudit } = useAudit();
  const [filter, setFilter] = useState("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [generated, setGenerated] = useState(null); // { user, password }

  // Активные офисы для dropdown'а
  const activeOffices = useMemo(
    () => offices.filter((o) => o.active !== false && o.status !== "closed"),
    [offices]
  );

  // Обёртки с audit-логированием
  const handleRoleChange = (user, newRole) => {
    const oldRole = user.role;
    updateUserRole(user.id, newRole);
    logAudit({
      action: "update",
      entity: "user",
      entityId: user.id,
      summary: `${user.name}: role ${ROLES[oldRole]?.label || oldRole} → ${ROLES[newRole]?.label || newRole}`,
    });
  };

  const handleOfficeChange = (user, newOfficeId) => {
    const oldOfficeId = user.officeId || null;
    const nextOfficeId = newOfficeId || null; // "" → null (global)
    if (oldOfficeId === nextOfficeId) return;
    updateUser(user.id, { officeId: nextOfficeId });
    const oldName = offices.find((o) => o.id === oldOfficeId)?.name || t("user_office_global");
    const newName = offices.find((o) => o.id === nextOfficeId)?.name || t("user_office_global");
    logAudit({
      action: "update",
      entity: "user",
      entityId: user.id,
      summary: `${user.name}: office ${oldName} → ${newName}`,
    });
  };

  const handleDeactivate = (user) => {
    if (!confirm(t("confirm_deactivate"))) return;
    deactivateUser(user.id);
    logAudit({
      action: "deactivate",
      entity: "user",
      entityId: user.id,
      summary: `Dismissed ${user.name} (${ROLES[user.role]?.label})`,
    });
  };

  const handleReactivate = (user) => {
    reactivateUser(user.id);
    logAudit({
      action: "reactivate",
      entity: "user",
      entityId: user.id,
      summary: `Reactivated ${user.name}`,
    });
  };

  const handleCreated = (result) => {
    setCreateOpen(false);
    setGenerated(result);
    logAudit({
      action: "create",
      entity: "user",
      entityId: result.user.id,
      summary: `Created ${result.user.name} (${ROLES[result.user.role]?.label})`,
    });
  };

  const visibleUsers = useMemo(() => {
    if (filter === "active") return users.filter((u) => u.active !== false);
    return users.filter((u) => u.active === false);
  }, [users, filter]);

  const activeCount = users.filter((u) => u.active !== false).length;
  const inactiveCount = users.filter((u) => u.active === false).length;

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-slate-500" />
          <h3 className="text-[15px] font-semibold tracking-tight">{t("settings_users")}</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            options={[
              { id: "active", name: `${t("active_users")} · ${activeCount}` },
              { id: "inactive", name: `${t("inactive_users")} · ${inactiveCount}` },
            ]}
            value={filter}
            onChange={setFilter}
            size="sm"
          />
          {isAdmin && (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t("add_user")}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
              <th className="px-5 py-2.5 font-bold">{t("ref_manager")}</th>
              <th className="px-3 py-2.5 font-bold">{t("email_label")}</th>
              <th className="px-3 py-2.5 font-bold">Role</th>
              <th className="px-3 py-2.5 font-bold">{t("user_office")}</th>
              <th className="px-3 py-2.5 font-bold">{t("created_at")}</th>
              <th className="px-3 py-2.5 font-bold">{t("status")}</th>
              <th className="px-5 py-2.5 font-bold text-right">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => {
              const isActive = u.active !== false;
              return (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold ${
                          u.role === "admin"
                            ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
                            : u.role === "accountant"
                            ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                            : "bg-gradient-to-br from-slate-700 to-slate-900"
                        } ${!isActive ? "opacity-50 grayscale" : ""}`}
                      >
                        {u.initials}
                      </div>
                      <div>
                        <div className={`text-[13px] font-semibold ${isActive ? "text-slate-900" : "text-slate-500"}`}>
                          {u.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{u.email || "—"}</td>
                  <td className="px-3 py-3">
                    {isAdmin && isActive ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value)}
                        className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-[8px] px-2 py-1 text-[12px] font-semibold outline-none"
                      >
                        {ROLE_IDS.map((r) => (
                          <option key={r} value={r}>
                            {t(`role_${r}`) !== `role_${r}` ? t(`role_${r}`) : ROLES[r].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {u.role === "admin" && <ShieldCheck className="w-3 h-3 text-indigo-500" />}
                        {ROLES[u.role]?.label || u.role}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {isAdmin && isActive ? (
                      <select
                        value={u.officeId || ""}
                        onChange={(e) => handleOfficeChange(u, e.target.value)}
                        className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-[8px] px-2 py-1 text-[12px] font-medium outline-none max-w-[150px]"
                      >
                        <option value="">{t("user_office_global")}</option>
                        {activeOffices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[12px] text-slate-600">
                        {u.officeId
                          ? offices.find((o) => o.id === u.officeId)?.name || "—"
                          : t("user_office_global")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500 tabular-nums">{u.createdAt || "—"}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                      {isActive ? t("active_status") : t("inactive_status")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {isAdmin && (
                      <>
                        {isActive ? (
                          <button
                            onClick={() => handleDeactivate(u)}
                            className="text-[12px] font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded-md transition-colors"
                          >
                            {t("deactivate")}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(u)}
                            className="text-[12px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors"
                          >
                            {t("reactivate")}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibleUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  {filter === "active" ? "No active users" : "No inactive users"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <GeneratedPasswordModal
        data={generated}
        onClose={() => setGenerated(null)}
      />
    </>
  );
}

// ------- Create user modal -------
function CreateUserModal({ open, onClose, onCreated }) {
  const { t } = useTranslation();
  const { createUser } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");

  React.useEffect(() => {
    if (open) {
      setName(""); setEmail(""); setRole("manager");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const result = createUser({ name, email, role });
    if (result) onCreated(result);
  };

  return (
    <Modal open={open} onClose={onClose} title={t("add_user")} width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            <UserIcon className="w-3 h-3 inline mr-1" /> {t("name_label")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Jane Doe"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("email_label")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@coinplata.io"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Role
          </label>
          <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap">
            {ROLE_IDS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`px-3 py-1.5 text-[12px] font-semibold rounded-[8px] transition-all ${
                  role === r
                    ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {ROLES[r].label}
              </button>
            ))}
          </div>
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
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim()
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("add_user")}
        </button>
      </div>
    </Modal>
  );
}

// ------- Generated password modal (one-time) -------
function GeneratedPasswordModal({ data, onClose }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const copy = () => {
    navigator.clipboard?.writeText(data.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal
      open={!!data}
      onClose={onClose}
      title={`✓ ${data.user.name} created`}
      subtitle={`${data.user.email || "no email"} · ${ROLES[data.user.role].label}`}
      width="md"
    >
      <div className="p-5">
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
          {t("generated_password")}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-900 text-emerald-400 font-mono text-[15px] px-4 py-3 rounded-[10px] tabular-nums tracking-wider select-all">
            {data.password}
          </div>
          <button
            onClick={copy}
            className={`inline-flex items-center gap-1.5 px-3 py-3 rounded-[10px] text-[13px] font-semibold transition-colors ${
              copied
                ? "bg-emerald-500 text-white"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("password_copied") : t("copy_password")}
          </button>
        </div>
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-[10px] text-[12px] text-amber-900">
          ⚠ {t("password_notice")}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Mock: in production, this would be sent to {data.user.email || "user's email"} via secure link.
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
        >
          {t("close")}
        </button>
      </div>
    </Modal>
  );
}
