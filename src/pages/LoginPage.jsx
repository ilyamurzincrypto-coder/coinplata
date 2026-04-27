// src/pages/LoginPage.jsx
// Invite-only login. ТОЛЬКО email + password.
//
// Magic-link УБРАН с logingPage намеренно: он позволял зайти в систему
// без когда-либо установленного пароля. Если юзер забыл пароль — есть
// "Forgot password?" → resetPasswordForEmail (recovery flow), который
// после клика на email link принудительно ведёт на SetPasswordPage.
//
// Работает даже когда Supabase не настроен (preview-режим): кнопки
// блокируются с подсказкой «not configured».

import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeftRight,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";

const REMEMBERED_EMAIL_KEY = "coinplata.loginEmail";
const APP_VERSION = "1.0.0"; // sync с package.json.version

export default function LoginPage() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL_KEY) || "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    // Autofocus на email если пусто, иначе на password.
    const t = setTimeout(() => {
      if (!email) emailRef.current?.focus();
      else passwordRef.current?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line

  useEffect(() => {
    try {
      if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    } catch {}
  }, [email]);

  const clearMessages = () => {
    setError(null);
    setInfo(null);
  };

  // Человеко-читаемое сообщение вместо supabase error raw.
  const mapAuthError = (e) => {
    if (!e) return "Unknown error";
    const msg = (e.message || "").toLowerCase();
    if (msg.includes("invalid login credentials"))
      return "Wrong email or password";
    if (msg.includes("email not confirmed"))
      return "Email not verified yet — check your invite link";
    if (msg.includes("user not found"))
      return "No user with this email";
    if (msg.includes("disabled") || msg.includes("banned"))
      return "This account is disabled. Contact an admin.";
    if (msg.includes("rate limit"))
      return "Too many attempts — try again in a minute";
    return e.message || "Sign-in failed";
  };

  const handlePasswordSignIn = async (e) => {
    e?.preventDefault?.();
    clearMessages();
    if (!isSupabaseConfigured) {
      setError("Supabase not configured — demo mode only");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Enter your password or use a magic link");
      passwordRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setError(mapAuthError(error));
        setLoading(false);
        return;
      }
      // При успехе Supabase обновит session; gate-компонент перерисует App → /cashier.
      // Здесь дополнительно ничего не делаем.
    } catch (err) {
      setError(mapAuthError(err));
      setLoading(false);
    }
  };

  // Forgot password — отправляет recovery email через resetPasswordForEmail.
  // После клика на email link Supabase создаёт session и выдаёт
  // onAuthStateChange event=PASSWORD_RECOVERY. URL hash содержит type=recovery
  // — AuthGate ловит оба сигнала и форсит SetPasswordPage.
  const handleForgotPassword = async () => {
    clearMessages();
    if (!isSupabaseConfigured) {
      setError("Supabase not configured — demo mode only");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email first");
      emailRef.current?.focus();
      return;
    }
    setRecoveryLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        setError(mapAuthError(error));
      } else {
        setInfo(`Recovery link sent to ${email.trim()} — open it to set a new password.`);
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleEmailKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 relative overflow-hidden flex items-center justify-center px-4 py-10 font-sans">
      {/* Декоративный background: радиальные пятна + grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 0%, rgba(16,185,129,0.12), transparent 70%), radial-gradient(ellipse 60% 60% at 50% 100%, rgba(15,23,42,0), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 80%)",
        }}
      />

      <div className="relative w-full max-w-[420px] animate-[cardIn_360ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        {/* Logo above card */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_8px_24px_-6px_rgba(16,185,129,0.55)]">
            <ArrowLeftRight className="w-4 h-4 text-slate-950" strokeWidth={2.5} />
          </div>
          <span className="text-[18px] font-bold tracking-tight text-white">
            CoinPlata
          </span>
        </div>

        {/* Card */}
        <div
          className="relative bg-slate-900/70 backdrop-blur-xl border border-slate-800 rounded-[20px] px-7 py-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 60px -20px rgba(0,0,0,0.7)",
          }}
        >
          <header className="mb-6">
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">
              Sign in to your account
            </h1>
            <p className="text-[13px] text-slate-400 mt-1.5">
              Secure access to your cashier system
            </p>
          </header>

          {/* Notice: Supabase not configured */}
          {!isSupabaseConfigured && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[12px]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Backend not connected yet — this is a UI preview. Inputs are for
                demo.
              </span>
            </div>
          )}

          <form onSubmit={handlePasswordSignIn} noValidate>
            {/* Email */}
            <Field
              icon={<Mail className="w-3.5 h-3.5" />}
              label="Email"
              htmlFor="email"
            >
              <input
                ref={emailRef}
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                disabled={loading}
                placeholder="you@company.com"
                className="w-full bg-transparent outline-none text-[14px] text-white placeholder:text-slate-500 py-2.5 disabled:opacity-60"
              />
            </Field>

            {/* Password */}
            <Field
              icon={<Lock className="w-3.5 h-3.5" />}
              label="Password"
              htmlFor="password"
              className="mt-3"
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              }
            >
              <input
                ref={passwordRef}
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
                className="w-full bg-transparent outline-none text-[14px] text-white placeholder:text-slate-500 py-2.5 disabled:opacity-60"
              />
            </Field>

            {/* Alerts */}
            {(error || info) && (
              <div className="mt-4">
                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[12px] animate-[fadeIn_200ms_ease-out]">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {info && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[12px] animate-[fadeIn_200ms_ease-out]">
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{info}</span>
                  </div>
                )}
              </div>
            )}

            {/* Primary button */}
            <button
              type="submit"
              disabled={loading || recoveryLoading}
              className={`mt-5 w-full h-11 rounded-[12px] inline-flex items-center justify-center gap-2 font-semibold text-[14px] transition-all ${
                loading || recoveryLoading
                  ? "bg-emerald-500/60 text-slate-950/60 cursor-not-allowed"
                  : "bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-950 hover:from-emerald-300 hover:to-emerald-500 shadow-[0_8px_20px_-8px_rgba(16,185,129,0.6)] hover:shadow-[0_12px_28px_-8px_rgba(16,185,129,0.75)] active:scale-[0.99]"
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>

            {/* Forgot password */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={loading || recoveryLoading}
                className="text-[12px] font-medium text-slate-400 hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {recoveryLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Sending recovery link…
                  </>
                ) : (
                  "Forgot password?"
                )}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-[11px] text-slate-500 leading-relaxed">
            Don't have an account?{" "}
            <span className="text-slate-400">Access is invite-only — ask an admin.</span>
          </p>
        </div>

        {/* Footer */}
        <footer className="mt-8 flex flex-col items-center gap-1.5 text-[10px] text-slate-600">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-slate-500" />
            Secure · Private · Internal system
          </div>
          <div className="text-slate-700">v{APP_VERSION}</div>
          {/* Escape hatch — если session cache "залип" и signin ведёт себя странно.
              Чистит все Supabase токены и перезагружает. */}
          <button
            type="button"
            onClick={() => {
              try {
                Object.keys(localStorage).forEach((k) => {
                  if (k.startsWith("sb-") || k.includes("supabase")) {
                    localStorage.removeItem(k);
                  }
                });
                sessionStorage.clear();
              } catch {}
              window.location.reload();
            }}
            className="mt-1 text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors"
          >
            Clear stored session
          </button>
        </footer>
      </div>

      <style>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// Поле — серая рамка + emerald focus-ring + inline иконка слева.
function Field({ icon, label, htmlFor, children, className = "", rightSlot }) {
  return (
    <div
      className={`group relative bg-slate-950/60 border border-slate-800 rounded-[12px] px-3 pt-1.5 pb-1 transition-colors focus-within:border-emerald-500/60 focus-within:ring-4 focus-within:ring-emerald-500/10 ${className}`}
    >
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 tracking-[0.1em] uppercase"
      >
        <span className="text-slate-500 group-focus-within:text-emerald-400 transition-colors">
          {icon}
        </span>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        {rightSlot}
      </div>
    </div>
  );
}
