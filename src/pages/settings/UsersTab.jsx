// src/pages/settings/UsersTab.jsx
// Users lifecycle: Invited → Active → Disabled.
// Actions (admin/owner):
//   — Reset password (генерит новый invite token, статус → invited)
//   — Disable / Enable
//   — Activate (mock flow — UI для ввода пароля за invited юзера)
// Нельзя disable себя и последнего owner'а — это проверяется в store.

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  UserPlus,
  Users as UsersIcon,
  Copy,
  Check,
  User as UserIcon,
  Key,
  Power,
  RotateCcw,
  Shield,
  Crown,
  Lock,
  Mail,
  Trash2,
} from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import Modal from "../../components/ui/Modal.jsx";
import { useAuth, ROLES, ROLE_IDS } from "../../store/auth.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { supabase, isSupabaseConfigured } from "../../lib/supabase.js";
import { useToast } from "../../lib/toast.jsx";
import { rpcSetUserStatus, updateUserRow, rpcInviteUser, rpcAdminSetPassword, withToast } from "../../lib/supabaseWrite.js";
import { loadPendingInvites } from "../../lib/supabaseReaders.js";
import { onDataBump } from "../../lib/dataVersion.jsx";

const STATUS_STYLE = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  invited: "bg-sky-50 text-sky-700 ring-sky-200",
  disabled: "bg-slate-100 text-slate-500 ring-slate-200",
};

// Стабильный формат "DD.MM.YY HH:MM" — независимо от browser locale.
// Раньше new Date(...).toLocaleString() показывал DD.MM.YYYY ru-юзеру и
// MM/DD/YYYY en-юзеру, что мешало сравнить запись с другим экраном.
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

function StatusBadge({ status }) {
  const cls = STATUS_STYLE[status] || STATUS_STYLE.active;
  const label =
    status === "invited"
      ? "Invited (awaiting setup)"
      : status === "disabled"
      ? "Disabled"
      : "Active";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${cls}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "active"
            ? "bg-emerald-500"
            : status === "invited"
            ? "bg-sky-500 animate-pulse"
            : "bg-slate-400"
        }`}
      />
      {label}
    </span>
  );
}

function RoleBadge({ role }) {
  const meta = ROLES[role] || { label: role };
  const cls =
    role === "owner"
      ? "bg-amber-50 text-amber-800"
      : role === "admin"
      ? "bg-indigo-50 text-indigo-800"
      : role === "accountant"
      ? "bg-emerald-50 text-emerald-800"
      : "bg-slate-100 text-slate-700";
  const Icon = role === "owner" ? Crown : role === "admin" ? Shield : null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {meta.label}
    </span>
  );
}

export default function UsersTab() {
  const { t } = useTranslation();
  const {
    users,
    currentUser,
    updateUserRole,
    updateUser,
    disableUser,
    enableUser,
    resetPassword,
    setUserPassword,
    activateUser,
    isAdmin,
    isOwner,
  } = useAuth();
  const { offices } = useOffices();
  const { addEntry: logAudit } = useAudit();
  const [filter, setFilter] = useState("visible"); // visible = active+invited; disabled; all
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState(null); // { user, inviteToken, kind: "created"|"reset" }
  const [activateFor, setActivateFor] = useState(null); // user object
  const [changePwFor, setChangePwFor] = useState(null); // user object
  const [toast, setToast] = useState(null);
  // pending_invites — заявки без auth.users (magic-link не клацнули или
  // OTP упал). Чтобы админ видел "висящие" приглашения.
  const [pendingInvites, setPendingInvites] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadPendingInvites()
        .then((rows) => {
          if (cancelled) return;
          setPendingInvites(rows || []);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[UsersTab] loadPendingInvites failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Email'ы которые УЖЕ материализовались в public.users — чтобы не
  // показывать их в "pending" даже если pending_invites row ещё не удалён.
  const existingEmails = useMemo(() => {
    const s = new Set();
    users.forEach((u) => {
      if (u.email) s.add(String(u.email).toLowerCase());
    });
    return s;
  }, [users]);

  const visiblePending = useMemo(
    () =>
      pendingInvites.filter(
        (p) => p.email && !existingEmails.has(String(p.email).toLowerCase())
      ),
    [pendingInvites, existingEmails]
  );

  const activeOffices = useMemo(
    () => offices.filter((o) => o.active !== false && o.status !== "closed"),
    [offices]
  );

  const canManage = isAdmin || isOwner;

  const showToast = useCallback((msg, tone = "error") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleResendInvite = useCallback(
    async (inv) => {
      if (!canManage || !inv?.email) return;
      try {
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email: inv.email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: window.location.origin,
          },
        });
        if (otpErr) {
          showToast(`Resend failed: ${otpErr.message}`);
          return;
        }
        showToast("Magic link resent", "success");
      } catch (err) {
        showToast(`Resend failed: ${err?.message || String(err)}`);
      }
    },
    [canManage, showToast]
  );

  const handleCancelInvite = useCallback(
    async (inv) => {
      if (!canManage || !inv?.email) return;
      if (!confirm(`Cancel pending invite for ${inv.email}?`)) return;
      try {
        const { error } = await supabase
          .from("pending_invites")
          .delete()
          .eq("email", inv.email);
        if (error) {
          showToast(`Cancel failed: ${error.message}`);
          return;
        }
        setPendingInvites((prev) => prev.filter((p) => p.email !== inv.email));
        showToast("Invite cancelled", "success");
      } catch (err) {
        showToast(`Cancel failed: ${err?.message || String(err)}`);
      }
    },
    [canManage, showToast]
  );

  const handleRoleChange = async (user, newRole) => {
    if (newRole === "owner" && !isOwner) {
      showToast("Only an owner can promote to owner");
      return;
    }
    const oldRole = user.role;
    if (oldRole === newRole) return;
    // Optimistic UI — local update сразу; БД следом. При ошибке откатим.
    updateUserRole(user.id, newRole);
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => updateUserRow(user.id, { role: newRole }),
        { success: "Role updated", errorPrefix: "Role change failed" }
      );
      if (!res.ok) {
        // rollback
        updateUserRole(user.id, oldRole);
        return;
      }
    }
    logAudit({
      action: "update",
      entity: "user",
      entityId: user.id,
      summary: `${user.name}: role ${ROLES[oldRole]?.label || oldRole} → ${ROLES[newRole]?.label || newRole}`,
    });
  };

  const handleOfficeChange = async (user, newOfficeId) => {
    const nextOfficeId = newOfficeId || null;
    const oldOfficeId = user.officeId || null;
    if (oldOfficeId === nextOfficeId) return;
    updateUser(user.id, { officeId: nextOfficeId });
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => updateUserRow(user.id, { officeId: nextOfficeId }),
        { success: "Office updated", errorPrefix: "Office change failed" }
      );
      if (!res.ok) {
        updateUser(user.id, { officeId: oldOfficeId });
        return;
      }
    }
    const oldName = offices.find((o) => o.id === oldOfficeId)?.name || t("user_office_global");
    const newName = offices.find((o) => o.id === nextOfficeId)?.name || t("user_office_global");
    logAudit({
      action: "update",
      entity: "user",
      entityId: user.id,
      summary: `${user.name}: office ${oldName} → ${newName}`,
    });
  };

  const handleDisable = async (user) => {
    if (!confirm(`Disable ${user.name}? They will not be able to log in.`)) return;

    // DB mode: UPDATE public.users SET status='disabled' — иначе in-memory
    // disable сбрасывается при следующем bump/reload из БД.
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcSetUserStatus(user.id, "disabled"),
        { success: "User disabled", errorPrefix: "Disable failed" }
      );
      if (res.ok) {
        logAudit({
          action: "disable",
          entity: "user",
          entityId: user.id,
          summary: `Disabled ${user.name} (${ROLES[user.role]?.label || user.role})`,
        });
      }
      return;
    }

    const res = disableUser(user.id);
    if (!res.ok) {
      showToast(res.warning || "Cannot disable user");
      return;
    }
    logAudit({
      action: "disable",
      entity: "user",
      entityId: user.id,
      summary: `Disabled ${user.name} (${ROLES[user.role]?.label || user.role})`,
    });
  };

  const handleEnable = async (user) => {
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcSetUserStatus(user.id, "active"),
        { success: "User enabled", errorPrefix: "Enable failed" }
      );
      if (res.ok) {
        logAudit({
          action: "enable",
          entity: "user",
          entityId: user.id,
          summary: `Re-enabled ${user.name}`,
        });
      }
      return;
    }

    enableUser(user.id);
    logAudit({
      action: "enable",
      entity: "user",
      entityId: user.id,
      summary: `Re-enabled ${user.name}`,
    });
  };

  const handleResetPassword = (user) => {
    if (!confirm(`Reset password for ${user.name}? They will need to set a new one via the invite link.`)) return;
    const res = resetPassword(user.id);
    if (!res.ok) {
      showToast(res.warning || "Cannot reset password");
      return;
    }
    logAudit({
      action: "reset_password",
      entity: "user",
      entityId: user.id,
      summary: `Password reset for ${user.name} — status → invited`,
    });
    setInviteResult({ user, inviteToken: res.inviteToken, kind: "reset" });
  };

  const handleCreated = (result) => {
    setCreateOpen(false);
    if (!result) return;
    setInviteResult({ user: result.user, inviteToken: result.inviteToken, kind: "created" });
    logAudit({
      action: "create",
      entity: "user",
      entityId: result.user.id,
      summary: `Created ${result.user.name} (${ROLES[result.user.role]?.label || result.user.role}) — status: invited`,
    });
  };

  const handleChangePassword = async (user, newPass) => {
    // DB mode — реальная запись в auth.users через RPC admin_set_password
    // (security definer + bcrypt). Раньше setUserPassword был in-memory
    // моком — пароль не менялся в Supabase Auth, юзер не мог войти.
    if (isSupabaseConfigured) {
      try {
        await rpcAdminSetPassword(user.id, newPass);
      } catch (err) {
        return { ok: false, warning: err?.message || String(err) };
      }
      // Локально тоже обновим status/passwordHash чтобы UI сразу отразил
      // active state до следующего refetch из DB.
      setUserPassword(user.id, newPass);
      logAudit({
        action: "set_password",
        entity: "user",
        entityId: user.id,
        summary: `Password set directly for ${user.name}`,
      });
      showToast("Password updated", "success");
      return { ok: true };
    }

    // Demo / no Supabase — локальный mock-flow.
    const res = setUserPassword(user.id, newPass);
    if (!res.ok) return { ok: false, warning: res.warning };
    logAudit({
      action: "set_password",
      entity: "user",
      entityId: user.id,
      summary: `Password changed directly for ${user.name}`,
    });
    showToast("Password updated", "success");
    return { ok: true };
  };

  const handleActivate = (user, password) => {
    const res = activateUser(user.id, password, user.inviteToken);
    if (!res.ok) {
      return { ok: false, warning: res.warning };
    }
    logAudit({
      action: "activate",
      entity: "user",
      entityId: user.id,
      summary: `${user.name} activated — status → active`,
    });
    return { ok: true };
  };

  const visibleUsers = useMemo(() => {
    if (filter === "disabled") return users.filter((u) => u.status === "disabled");
    if (filter === "all") return users;
    return users.filter((u) => u.status !== "disabled"); // active + invited
  }, [users, filter]);

  const counts = useMemo(() => {
    let active = 0, invited = 0, disabled = 0;
    users.forEach((u) => {
      if (u.status === "invited") invited++;
      else if (u.status === "disabled") disabled++;
      else active++;
    });
    return { active, invited, disabled };
  }, [users]);

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-slate-500" />
          <h3 className="text-[15px] font-semibold tracking-tight">{t("settings_users")}</h3>
          <span className="text-[11px] text-slate-400">
            · {counts.active} active · {counts.invited} invited · {counts.disabled} disabled
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            options={[
              { id: "visible", name: `Active+Invited · ${counts.active + counts.invited}` },
              { id: "disabled", name: `Disabled · ${counts.disabled}` },
              { id: "all", name: `All · ${users.length}` },
            ]}
            value={filter}
            onChange={setFilter}
            size="sm"
          />
          {canManage && (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Invite user
            </button>
          )}
        </div>
      </div>

      {/* Pending invites — заявки без соответствующего auth.users (magic-link
          не клацнут / OTP упал / юзер ещё не пришёл). Чтобы админ видел
          "висячие" приглашения и мог их пересоздать/отменить. */}
      {visiblePending.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-3.5 h-3.5 text-amber-700" />
            <span className="text-[11px] font-bold text-amber-900 tracking-[0.12em] uppercase">
              Pending invites · {visiblePending.length}
            </span>
            <span className="text-[11px] text-amber-700">
              — magic-link отправлен, но юзер ещё не пришёл
            </span>
          </div>
          <div className="space-y-1">
            {visiblePending.map((inv) => (
              <div
                key={inv.email}
                className="flex items-center gap-2 px-3 py-2 bg-white rounded-[10px] border border-amber-200 text-[12px]"
              >
                <Mail className="w-3 h-3 text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {inv.fullName || inv.email}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                      {inv.email}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {ROLES[inv.role]?.label || inv.role}
                    {inv.createdAt && (
                      <>
                        {" · "}
                        {fmtDateTime(inv.createdAt)}
                      </>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleResendInvite(inv)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-amber-800 hover:text-amber-900 hover:bg-amber-100 transition-colors"
                      title="Переотправить magic-link"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Resend
                    </button>
                    <button
                      onClick={() => handleCancelInvite(inv)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-rose-700 hover:text-rose-900 hover:bg-rose-50 transition-colors"
                      title="Удалить приглашение"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
              <th className="px-5 py-2.5 font-bold">Name</th>
              <th className="px-3 py-2.5 font-bold">Email</th>
              <th className="px-3 py-2.5 font-bold">Role</th>
              <th className="px-3 py-2.5 font-bold">Office</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
              <th className="px-5 py-2.5 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => {
              const isSelf = u.id === currentUser.id;
              const isDisabled = u.status === "disabled";
              const isInvited = u.status === "invited";
              return (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold ${
                          u.role === "owner"
                            ? "bg-gradient-to-br from-amber-500 to-amber-700"
                            : u.role === "admin"
                            ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
                            : u.role === "accountant"
                            ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                            : "bg-gradient-to-br from-slate-700 to-slate-900"
                        } ${isDisabled ? "opacity-50 grayscale" : ""}`}
                      >
                        {u.initials}
                      </div>
                      <div>
                        <div className={`text-[13px] font-semibold ${isDisabled ? "text-slate-500" : "text-slate-900"}`}>
                          {u.name}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] font-semibold text-indigo-600">(you)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{u.email || "—"}</td>
                  <td className="px-3 py-3">
                    {canManage && !isDisabled && !isSelf ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value)}
                        className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-[8px] px-2 py-1 text-[12px] font-semibold outline-none"
                      >
                        {ROLE_IDS.map((r) => (
                          <option key={r} value={r} disabled={r === "owner" && !isOwner}>
                            {ROLES[r].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={u.role} />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {canManage && !isDisabled ? (
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
                  <td className="px-3 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {canManage && isInvited && (
                        <button
                          onClick={() => setActivateFor(u)}
                          className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 hover:bg-sky-50 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                          title="Mock activate — set password for this invited user"
                        >
                          <Key className="w-3 h-3" />
                          Activate
                        </button>
                      )}
                      {canManage && !isSelf && u.status !== "disabled" && (
                        <button
                          onClick={() => setChangePwFor(u)}
                          className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                          title="Set a new password directly"
                        >
                          <Lock className="w-3 h-3" />
                          Change password
                        </button>
                      )}
                      {canManage && !isSelf && u.status === "active" && (
                        <button
                          onClick={() => handleResetPassword(u)}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                          title="Invalidate password, send a fresh invite link"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                      {canManage && !isSelf && !isDisabled && (
                        <button
                          onClick={() => handleDisable(u)}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                        >
                          <Power className="w-3 h-3" />
                          Disable
                        </button>
                      )}
                      {canManage && isDisabled && (
                        <button
                          onClick={() => handleEnable(u)}
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Enable
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  No users match this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && (
        <div
          className={`px-5 py-2.5 text-[12px] font-medium border-t ${
            toast.tone === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <InviteTokenModal data={inviteResult} onClose={() => setInviteResult(null)} />

      <ActivateUserModal
        user={activateFor}
        onClose={() => setActivateFor(null)}
        onActivate={handleActivate}
      />

      <DirectPasswordModal
        user={changePwFor}
        onClose={() => setChangePwFor(null)}
        onSave={handleChangePassword}
      />
    </>
  );
}

// ------- Direct password change modal (owner/admin → any user except self) -------
function DirectPasswordModal({ user, onClose, onSave }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (user) {
      setPassword("");
      setConfirm("");
      setError("");
      setSaving(false);
    }
  }, [user]);

  if (!user) return null;

  const canSubmit = !saving && password.length >= 6 && password === confirm;

  const handleSubmit = async () => {
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      const res = await onSave(user, password);
      if (!res?.ok) {
        setError(res?.warning || "Could not set password");
        setSaving(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Change password for ${user.name}`}
      subtitle={`${user.email || "no email"} · ${ROLES[user.role]?.label || user.role}`}
      width="md"
    >
      <div className="p-5 space-y-3">
        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Direct change — user's status stays as-is (active → active, invited → active).
          No invite email, no token. Current password is NOT shown.
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            New password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="new-password"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Confirm password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          Cancel
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
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ------- Create user modal -------
function CreateUserModal({ open, onClose, onCreated }) {
  const { t } = useTranslation();
  const { createUser, isOwner } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [sending, setSending] = useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setRole("manager");
      setSending(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim() || sending) return;
    const cleanEmail = email.trim();

    // DB mode: security-definer RPC invite_user (migration 0022) + magic-link.
    //   1. invite_user — upsert pending_invites + update existing public.users.
    //      Атомарно гарантирует правильную роль для first-time / re-invite /
    //      legacy случаев (раньше все повторные инвайты застревали на manager).
    //   2. signInWithOtp — шлёт magic-link (если OTP rate-limited 429, роль уже
    //      синхнута, юзер сможет войти обычным способом).
    if (isSupabaseConfigured && cleanEmail) {
      setSending(true);
      try {
        try {
          await rpcInviteUser({
            email: cleanEmail,
            fullName: name.trim(),
            role,
            officeId: null,
          });
        } catch (inviteErr) {
          toast.error(`${t("invite_failed")}: ${inviteErr?.message || String(inviteErr)}`);
          setSending(false);
          return;
        }

        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: window.location.origin,
          },
        });
        if (otpErr) {
          // Роль уже записана в БД через invite_user — при следующем login
          // юзер получит корректные права. 429 (rate-limit) тут не откатывает
          // invite, только сообщаем что magic-link не ушёл.
          toast.error(`${t("invite_failed")}: ${otpErr.message}`);
          setSending(false);
          return;
        }

        toast.success(t("invite_success"));
        // Локально добавим чтобы сразу появился в списке (до refetch из DB)
        const localRes = createUser({ name, email: cleanEmail, role });
        onCreated(localRes);
      } catch (err) {
        toast.error(`${t("invite_failed")}: ${err?.message || String(err)}`);
        setSending(false);
      }
      return;
    }

    // Demo / no email — fallback on local invite with token link (как было)
    const result = createUser({ name, email: cleanEmail, role });
    if (result) onCreated(result);
  };

  return (
    <Modal open={open} onClose={onClose} title={t("invite_user_title")} width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            <UserIcon className="w-3 h-3 inline mr-1" /> {t("invite_field_name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={t("invite_placeholder_name")}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("invite_field_email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("invite_placeholder_email")}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("invite_field_role")}
          </label>
          <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap">
            {ROLE_IDS.map((r) => {
              const disabled = r === "owner" && !isOwner;
              return (
                <button
                  key={r}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRole(r)}
                  className={`px-3 py-1.5 text-[12px] font-semibold rounded-[8px] transition-all ${
                    role === r
                      ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
                      : disabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {ROLES[r].label}
                </button>
              );
            })}
          </div>
          {!isOwner && (
            <p className="text-[10px] text-slate-500 mt-1">{t("invite_owner_only_hint")}</p>
          )}
        </div>
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          {isSupabaseConfigured ? t("invite_info_hint") : t("invite_info_demo")}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={sending}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || sending}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim() && !sending
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {sending ? t("invite_sending") : t("invite_send")}
        </button>
      </div>
    </Modal>
  );
}

// ------- Invite token modal (shown once after create / reset) -------
function InviteTokenModal({ data, onClose }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const isReset = data.kind === "reset";
  const fakeLink = `https://coinplata.app/activate?uid=${data.user.id}&token=${data.inviteToken}`;

  const copy = () => {
    navigator.clipboard?.writeText(fakeLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const titleTpl = isReset ? t("invite_reset_title") : t("invite_token_title");
  return (
    <Modal
      open={!!data}
      onClose={onClose}
      title={titleTpl.replace("{name}", data.user.name)}
      subtitle={`${data.user.email || "no email"} · ${ROLES[data.user.role]?.label || data.user.role}`}
      width="md"
    >
      <div className="p-5">
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
          {t("invite_link_label")}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-900 text-emerald-400 font-mono text-[12px] px-3 py-2.5 rounded-[10px] break-all select-all">
            {fakeLink}
          </div>
          <button
            onClick={copy}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-[10px] text-[13px] font-semibold transition-colors ${
              copied ? "bg-emerald-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("btn_copied") : t("btn_copy")}
          </button>
        </div>
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-[10px] text-[12px] text-amber-900">
          {t("invite_link_warn")}
          {isReset && ` ${t("invite_reset_warn_extra")}`}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Mock: in production, this link is sent to {data.user.email || "the user's email"}.
          For the demo, use the "Activate" action on this user to set a password.
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

// ------- Activate user modal (mock of the external "set password" screen) -------
function ActivateUserModal({ user, onClose, onActivate }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  React.useEffect(() => {
    if (user) {
      setPassword("");
      setConfirm("");
      setError("");
      setSuccess(false);
    }
  }, [user]);

  if (!user) return null;

  const handleSubmit = () => {
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    const res = onActivate(user, password);
    if (!res.ok) {
      setError(res.warning || "Activation failed");
      return;
    }
    setSuccess(true);
    setTimeout(onClose, 900);
  };

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Activate ${user.name}`}
      subtitle="Set password (mock invite flow)"
      width="md"
    >
      <div className="p-5 space-y-3">
        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Mock invite token:{" "}
          <span className="font-mono text-[10px] bg-slate-900 text-emerald-400 px-1 rounded">
            {user.inviteToken ? `${user.inviteToken.slice(0, 8)}…` : "—"}
          </span>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            New password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Confirm password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Activated
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!password || !confirm || success}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            password && confirm && !success
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Activate
        </button>
      </div>
    </Modal>
  );
}
