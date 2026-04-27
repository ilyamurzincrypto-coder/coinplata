// src/pages/SetPasswordPage.jsx
// Принудительная установка пароля. Показывается когда:
//   а) public.users.status === 'invited' — invite flow от админа
//   б) public.users.password_set === false — юзер ещё ни разу не установил
//   в) PASSWORD_RECOVERY event / type=recovery в URL hash — forgot password
//
// После save:
//   1. supabase.auth.updateUser({ password }) — пишет пароль в Supabase Auth
//   2. RPC mark_password_set() — атомарно ставит password_set=true,
//      status='active', activated_at=now()
//   3. clearRecovery() — сбрасывает recoveryMode в AuthGate
//   4. bumpDataVersion → AuthProvider re-hydrate → Root показывает app

import React, { useState, useRef, useEffect } from "react";
import {
  ArrowLeftRight,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { bumpDataVersion } from "../lib/dataVersion.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useRecovery } from "../lib/recovery.jsx";

export default function SetPasswordPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { clearRecovery } = useRecovery();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => passwordRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (saving) return;
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
      // 1. Записываем пароль в Supabase Auth
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message || "Could not save password");
        setSaving(false);
        return;
      }

      // 2. mark_password_set RPC — атомарно ставит password_set=true,
      //    status='active', activated_at=now() для текущего auth.uid().
      //    Раньше делали прямой UPDATE из клиента — сейчас RPC надёжнее
      //    (security definer, обходит возможные RLS edge-cases).
      const { error: rpcErr } = await supabase.rpc("mark_password_set");
      if (rpcErr) {
        // eslint-disable-next-line no-console
        console.warn("[SetPassword] mark_password_set failed", rpcErr);
        // Fallback на прямой UPDATE — если RPC ещё не задеплоена.
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (uid) {
          await supabase
            .from("users")
            .update({
              status: "active",
              activated_at: new Date().toISOString(),
              password_set: true,
            })
            .eq("id", uid);
        }
      }

      setSuccess(true);
      // 3. Сбрасываем recoveryMode в AuthGate.
      clearRecovery();
      // 4. Триггерим reload store'ов — AuthGate перечитает password_set=true
      //    и пустит в приложение.
      setTimeout(() => bumpDataVersion(), 400);
    } catch (err) {
      setError(err?.message || "Something went wrong");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 relative overflow-hidden flex items-center justify-center px-4 py-10 font-sans">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 0%, rgba(16,185,129,0.12), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-[420px] animate-[cardIn_360ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_8px_24px_-6px_rgba(16,185,129,0.55)]">
            <ArrowLeftRight className="w-4 h-4 text-slate-950" strokeWidth={2.5} />
          </div>
          <span className="text-[18px] font-bold tracking-tight text-white">
            CoinPlata
          </span>
        </div>

        <div
          className="relative bg-slate-900/70 backdrop-blur-xl border border-slate-800 rounded-[20px] px-7 py-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 60px -20px rgba(0,0,0,0.7)",
          }}
        >
          <header className="mb-6">
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">
              Set your password
            </h1>
            <p className="text-[13px] text-slate-400 mt-1.5">
              Welcome{currentUser?.name ? `, ${currentUser.name}` : ""}! Choose a
              password to finish activation.
            </p>
          </header>

          <form onSubmit={handleSubmit} noValidate>
            <div className="bg-slate-950/60 border border-slate-800 rounded-[12px] px-3 pt-1.5 pb-1 focus-within:border-emerald-500/60 focus-within:ring-4 focus-within:ring-emerald-500/10 transition-colors">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 tracking-[0.1em] uppercase">
                <Lock className="w-3.5 h-3.5" /> New password
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={saving || success}
                  placeholder="••••••••"
                  className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-slate-500 py-2.5 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="mt-3 bg-slate-950/60 border border-slate-800 rounded-[12px] px-3 pt-1.5 pb-1 focus-within:border-emerald-500/60 focus-within:ring-4 focus-within:ring-emerald-500/10 transition-colors">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 tracking-[0.1em] uppercase">
                <Lock className="w-3.5 h-3.5" /> Confirm password
              </label>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={saving || success}
                placeholder="••••••••"
                className="w-full bg-transparent outline-none text-[14px] text-white placeholder:text-slate-500 py-2.5 disabled:opacity-60"
              />
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[12px]">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[12px]">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Password saved. Loading your workspace…</span>
              </div>
            )}

            <button
              type="submit"
              disabled={saving || success || !password || !confirm}
              className={`mt-5 w-full h-11 rounded-[12px] inline-flex items-center justify-center gap-2 font-semibold text-[14px] transition-all ${
                saving || success || !password || !confirm
                  ? "bg-emerald-500/60 text-slate-950/60 cursor-not-allowed"
                  : "bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-950 hover:from-emerald-300 hover:to-emerald-500 shadow-[0_8px_20px_-8px_rgba(16,185,129,0.6)] active:scale-[0.99]"
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Activated
                </>
              ) : (
                <>
                  Set password
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>

        <footer className="mt-8 flex flex-col items-center gap-1.5 text-[10px] text-slate-600">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-slate-500" />
            Secure · Private · Internal system
          </div>
        </footer>
      </div>

      <style>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
