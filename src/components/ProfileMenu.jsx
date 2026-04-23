// src/components/ProfileMenu.jsx
// Dropdown у аватара.
// DB mode: logout → supabase.auth.signOut; change password → Supabase updateUser;
//          switch user скрыт (нужно logout + login заново).
// Demo mode: switch user работает локально, logout/password = alert-stub.

import React, { useState, useRef, useEffect } from "react";
import { Camera, Key, LogOut, ShieldCheck, Crown, ChevronDown, Check, Users as UsersIcon, Loader2 } from "lucide-react";
import { useAuth, ROLES } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import Modal from "./ui/Modal.jsx";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { useToast } from "../lib/toast.jsx";

export default function ProfileMenu() {
  const { t } = useTranslation();
  const { currentUser, users, isAdmin, isOwner, switchUser } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const stub = (msg) => {
    setOpen(false);
    alert(msg + " — will be wired to backend in next release.");
  };

  // LOGOUT — в DB mode вызываем supabase.auth.signOut. AuthGate ловит
  // onAuthStateChange → session=null → показывает LoginPage. Плюс safety
  // reload() в конце на случай если listener по какой-то причине не сработал.
  const handleLogout = async () => {
    if (loggingOut) return;
    if (!isSupabaseConfigured) {
      setOpen(false);
      alert(t("demo_no_session"));
      return;
    }
    setLoggingOut(true);
    // Чистим session-draft — не нужно продолжать чужую форму.
    try {
      sessionStorage.removeItem("coinplata.exchangeDraft");
    } catch {}
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(`${t("err_logout")}: ${error.message}`);
        setLoggingOut(false);
        return;
      }
      setTimeout(() => {
        window.location.href = window.location.pathname || "/";
      }, 150);
    } catch (err) {
      toast.error(`${t("err_logout")}: ${err?.message || String(err)}`);
      setLoggingOut(false);
    }
  };

  const handleSwitch = (id) => {
    const res = switchUser(id);
    if (!res.ok) {
      setSwitchError(res.warning || "Cannot switch to this user");
      setTimeout(() => setSwitchError(""), 3500);
      return;
    }
    setSwitcherOpen(false);
    setOpen(false);
  };

  const roleLabel = ROLES[currentUser.role]?.label || currentUser.role;
  const RoleIcon = currentUser.role === "owner" ? Crown : isAdmin ? ShieldCheck : null;
  const avatarGradient =
    currentUser.role === "owner"
      ? "from-amber-500 to-amber-700"
      : isAdmin
      ? "from-indigo-500 to-indigo-700"
      : "from-slate-700 to-slate-900";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-2 py-1 pr-2 rounded-[10px] hover:bg-slate-50 transition-colors"
      >
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold bg-gradient-to-br ${avatarGradient}`}
        >
          {currentUser.initials}
        </div>
        <div className="hidden sm:block text-[12px] leading-tight text-left">
          <div className="font-medium text-slate-900">{currentUser.name}</div>
          <div className="text-slate-500 flex items-center gap-1">
            {RoleIcon && <RoleIcon className="w-2.5 h-2.5 text-indigo-500" />}
            {roleLabel}
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 hidden sm:block transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white border border-slate-200 rounded-[12px] shadow-[0_16px_40px_-12px_rgba(15,23,42,0.25)] overflow-hidden animate-[fadeIn_120ms_ease-out]">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-[13px] font-semibold text-slate-900">{currentUser.name}</div>
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              {RoleIcon && <RoleIcon className="w-2.5 h-2.5 text-indigo-500" />}
              {roleLabel} · status: {currentUser.status || "active"}
            </div>
          </div>
          <div className="py-1">
            <MenuItem icon={<Camera className="w-3.5 h-3.5" />} onClick={() => stub(t("change_photo"))}>
              {t("change_photo")}
            </MenuItem>
            <MenuItem
              icon={<Key className="w-3.5 h-3.5" />}
              onClick={() => {
                setOpen(false);
                setPasswordModalOpen(true);
              }}
            >
              {t("change_password")}
            </MenuItem>
            {/* Switch user имеет смысл только в demo-режиме — там он
                меняет локального currentUserId. В DB mode чтобы сменить
                пользователя нужен полный logout + login через Supabase auth. */}
            {!isSupabaseConfigured && (
              <MenuItem
                icon={<UsersIcon className="w-3.5 h-3.5" />}
                onClick={() => setSwitcherOpen((v) => !v)}
              >
                Switch user (demo)
              </MenuItem>
            )}
          </div>
          {switcherOpen && (
            <div className="border-t border-slate-100 bg-slate-50/60 py-1 max-h-60 overflow-auto">
              {users.map((u) => {
                const isCurrent = u.id === currentUser.id;
                const locked = u.status === "disabled" || u.status === "invited";
                return (
                  <button
                    key={u.id}
                    disabled={isCurrent}
                    onClick={() => handleSwitch(u.id)}
                    className={`w-full flex items-center gap-2 px-4 py-1.5 text-[12px] text-left transition-colors ${
                      isCurrent
                        ? "text-slate-400 cursor-not-allowed"
                        : locked
                        ? "text-slate-400 hover:bg-slate-100"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="font-semibold">{u.name}</span>
                    <span className="text-[10px] text-slate-400">· {ROLES[u.role]?.label || u.role}</span>
                    {u.status !== "active" && (
                      <span className="ml-auto text-[9px] uppercase font-bold text-slate-400">{u.status}</span>
                    )}
                    {isCurrent && <Check className="ml-auto w-3 h-3 text-emerald-500" />}
                  </button>
                );
              })}
              {switchError && (
                <div className="px-4 py-1.5 text-[11px] font-medium text-rose-700 bg-rose-50">
                  {switchError}
                </div>
              )}
            </div>
          )}
          <div className="py-1 border-t border-slate-100">
            <MenuItem
              icon={
                loggingOut ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LogOut className="w-3.5 h-3.5" />
                )
              }
              onClick={handleLogout}
              danger
              disabled={loggingOut}
            >
              {loggingOut ? t("signing_out") : t("logout")}
            </MenuItem>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <ChangePasswordModal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
      />
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

// -------- Change password modal --------
function ChangePasswordModal({ open, onClose }) {
  const { changeOwnPassword, currentUser } = useAuth();
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setOldPass("");
      setNewPass("");
      setConfirm("");
      setError("");
      setSuccess(false);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError("");
    if (submitting) return;
    if (newPass.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (newPass !== confirm) {
      setError("Passwords don't match");
      return;
    }

    // DB mode: подтверждаем old pass через re-sign-in, затем updateUser.
    // Иначе stolen-token-риск: кто угодно с текущей сессией смог бы менять пароль.
    if (isSupabaseConfigured) {
      setSubmitting(true);
      try {
        const email = currentUser.email;
        if (!email) {
          setError("Current user has no email — cannot verify");
          setSubmitting(false);
          return;
        }
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email,
          password: oldPass,
        });
        if (signErr) {
          setError("Current password is incorrect");
          setSubmitting(false);
          return;
        }
        const { error: upErr } = await supabase.auth.updateUser({
          password: newPass,
        });
        if (upErr) {
          setError(upErr.message || "Could not update password");
          setSubmitting(false);
          return;
        }
        setSuccess(true);
        setSubmitting(false);
        setTimeout(onClose, 900);
      } catch (err) {
        setError(err?.message || "Could not change password");
        setSubmitting(false);
      }
      return;
    }

    // Demo mode — in-memory password hash.
    const res = changeOwnPassword(oldPass, newPass);
    if (!res.ok) {
      setError(res.warning || "Could not change password");
      return;
    }
    setSuccess(true);
    setTimeout(onClose, 900);
  };

  return (
    <Modal open={open} onClose={onClose} title="Change password" subtitle={currentUser.name} width="md">
      <div className="p-5 space-y-3">
        {!isSupabaseConfigured && (
          <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            Demo accounts are seeded with password <span className="font-mono font-semibold">demo</span>.
          </div>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Current password
          </label>
          <input
            type="password"
            value={oldPass}
            onChange={(e) => setOldPass(e.target.value)}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            New password
          </label>
          <input
            type="password"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Confirm new password
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
            Password changed
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
          disabled={!oldPass || !newPass || !confirm || success || submitting}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            oldPass && newPass && confirm && !success && !submitting
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {submitting ? "Updating…" : "Change password"}
        </button>
      </div>
    </Modal>
  );
}
