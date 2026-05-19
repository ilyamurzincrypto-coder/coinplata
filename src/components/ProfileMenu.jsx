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

// Ключ для аватара в localStorage. Хранится data-URL per user.
// Не требует миграции БД. Локально на устройстве — если user залогинился
// на другом — аватара не будет. Для глобального хранения нужна Supabase
// Storage + колонка public.users.avatar_url (отдельная миграция).
const AVATAR_KEY = (userId) => `coinplata.avatar.${userId}`;

function readAvatar(userId) {
  if (!userId) return null;
  try {
    return localStorage.getItem(AVATAR_KEY(userId));
  } catch {
    return null;
  }
}

function writeAvatar(userId, dataUrl) {
  if (!userId) return;
  try {
    localStorage.setItem(AVATAR_KEY(userId), dataUrl);
  } catch {}
}

function removeAvatar(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(AVATAR_KEY(userId));
  } catch {}
}

export default function ProfileMenu() {
  const { t } = useTranslation();
  const { currentUser, users, isAdmin, isOwner, switchUser } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(() => readAvatar(currentUser?.id));
  const fileInputRef = useRef(null);
  const ref = useRef(null);

  // Подгружаем аватар при смене юзера
  useEffect(() => {
    setAvatarUrl(readAvatar(currentUser?.id));
  }, [currentUser?.id]);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // сбросить для повторного выбора того же файла
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 500 * 1024) {
      toast.error("Image is too large (max 500 KB after crop). Please pick a smaller one or crop it first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl !== "string") return;
      // Попытка ограничить размер через canvas resize до 256x256
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        // cover crop (square)
        const ratio = img.width / img.height;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (ratio > 1) {
          sw = img.height;
          sx = (img.width - img.height) / 2;
        } else if (ratio < 1) {
          sh = img.width;
          sy = (img.height - img.width) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
        const compressed = canvas.toDataURL("image/jpeg", 0.8);
        writeAvatar(currentUser.id, compressed);
        setAvatarUrl(compressed);
        toast.success(t("photo_updated"));
        setOpen(false);
      };
      img.onerror = () => toast.error("Could not load image");
      img.src = dataUrl;
    };
    reader.onerror = () => toast.error("Could not read file");
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    removeAvatar(currentUser.id);
    setAvatarUrl(null);
    toast.success(t("photo_removed"));
    setOpen(false);
  };

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
      : "from-ink to-ink";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-2 py-1 pr-2 rounded-card hover:bg-surface-soft transition-colors"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={currentUser.name}
            className="w-7 h-7 rounded-full object-cover ring-1 ring-border-soft"
          />
        ) : (
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-tiny font-semibold bg-gradient-to-br ${avatarGradient}`}
          >
            {currentUser.initials}
          </div>
        )}
        <div className="hidden sm:block text-caption leading-tight text-left">
          <div className="font-medium text-ink">{currentUser.name}</div>
          <div className="text-muted flex items-center gap-1">
            {RoleIcon && <RoleIcon className="w-2.5 h-2.5 text-accent" />}
            {roleLabel}
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-soft hidden sm:block transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white border border-border-soft rounded-card shadow-[0_16px_40px_-12px_rgba(15,23,42,0.25)] overflow-hidden animate-[fadeIn_120ms_ease-out]">
          <div className="px-4 py-3 border-b border-border-soft">
            <div className="text-body-sm font-semibold text-ink">{currentUser.name}</div>
            <div className="text-tiny text-muted flex items-center gap-1">
              {RoleIcon && <RoleIcon className="w-2.5 h-2.5 text-accent" />}
              {roleLabel} · status: {currentUser.status || "active"}
            </div>
          </div>
          <div className="py-1">
            <MenuItem
              icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("change_photo")}
            </MenuItem>
            {avatarUrl && (
              <MenuItem
                icon={<Camera className="w-3.5 h-3.5" />}
                onClick={handleRemovePhoto}
                danger
              >
                {t("remove_photo")}
              </MenuItem>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
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
            <div className="border-t border-border-soft bg-surface-soft/60 py-1 max-h-60 overflow-auto">
              {users.map((u) => {
                const isCurrent = u.id === currentUser.id;
                const locked = u.status === "disabled" || u.status === "invited";
                return (
                  <button
                    key={u.id}
                    disabled={isCurrent}
                    onClick={() => handleSwitch(u.id)}
                    className={`w-full flex items-center gap-2 px-4 py-1.5 text-caption text-left transition-colors ${
                      isCurrent
                        ? "text-muted-soft cursor-not-allowed"
                        : locked
                        ? "text-muted-soft hover:bg-surface-sunk"
                        : "text-ink-soft hover:bg-surface-sunk"
                    }`}
                  >
                    <span className="font-semibold">{u.name}</span>
                    <span className="text-tiny text-muted-soft">· {ROLES[u.role]?.label || u.role}</span>
                    {u.status !== "active" && (
                      <span className="ml-auto text-micro uppercase font-bold text-muted-soft">{u.status}</span>
                    )}
                    {isCurrent && <Check className="ml-auto w-3 h-3 text-success" />}
                  </button>
                );
              })}
              {switchError && (
                <div className="px-4 py-1.5 text-tiny font-medium text-danger bg-danger-soft">
                  {switchError}
                </div>
              )}
            </div>
          )}
          <div className="py-1 border-t border-border-soft">
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
      className={`w-full flex items-center gap-2.5 px-4 py-2 text-body-sm text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        danger ? "text-danger hover:bg-danger-soft" : "text-ink-soft hover:bg-surface-soft"
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
          <div className="text-tiny text-ink-soft bg-surface-soft border border-border-soft rounded-md px-3 py-2">
            Demo accounts are seeded with password <span className="font-mono font-semibold">demo</span>.
          </div>
        )}
        <div>
          <label className="block text-tiny font-semibold text-muted mb-1.5 tracking-wide uppercase">
            Current password
          </label>
          <input
            type="password"
            value={oldPass}
            onChange={(e) => setOldPass(e.target.value)}
            autoFocus
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
          />
        </div>
        <div>
          <label className="block text-tiny font-semibold text-muted mb-1.5 tracking-wide uppercase">
            New password
          </label>
          <input
            type="password"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
          />
        </div>
        <div>
          <label className="block text-tiny font-semibold text-muted mb-1.5 tracking-wide uppercase">
            Confirm new password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
          />
        </div>
        {error && (
          <div className="text-caption font-medium text-danger bg-danger-soft border border-danger/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-caption font-medium text-success bg-success-soft border border-success/20 rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Password changed
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!oldPass || !newPass || !confirm || success || submitting}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold transition-colors ${
            oldPass && newPass && confirm && !success && !submitting
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {submitting ? "Updating…" : "Change password"}
        </button>
      </div>
    </Modal>
  );
}
