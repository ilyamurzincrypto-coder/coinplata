// src/pages/LoginPage.jsx
// Invite-only login. ТОЛЬКО email + password.
//
// Magic-link УБРАН с logingPage намеренно: он позволял зайти в систему
// без когда-либо установленного пароля. Если юзер забыл пароль — есть
// "Забыли пароль?" → resetPasswordForEmail (recovery flow), который
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
import { isPersistentStorageAvailable } from "../lib/authStorage.js";

const REMEMBERED_EMAIL_KEY = "coinplata.loginEmail";
// Сколько ждём, пока сессия материализуется в клиенте после успешного ответа
// сервера. Больше секунды человек уже считает, что «висит».
const SESSION_WAIT_MS = 2500;

/**
 * Ждёт появления сессии; true — появилась, false — истёк таймаут.
 * Экспортируется ради теста: если этот таймаут сломать, вернётся вечное
 * «Signing in…» — тот самый баг, из-за которого и затевался auth-PR.
 */
export async function waitForSession(timeoutMs, client = supabase) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { data } = await client.auth.getSession();
      if (data?.session) return true;
    } catch {
      /* клиент ещё не готов — пробуем снова */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
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
  // Проба хранилища на СТАРТЕ: предупреждение должно стоять до того, как
  // человек потратит попытку входа, а не после неё.
  const [storageOk] = useState(() => isPersistentStorageAvailable());

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
    if (!e) return "Неизвестная ошибка";
    const msg = (e.message || "").toLowerCase();
    if (msg.includes("invalid login credentials"))
      return "Неверная почта или пароль";
    if (msg.includes("email not confirmed"))
      return "Почта ещё не подтверждена — откройте ссылку из приглашения";
    if (msg.includes("user not found"))
      return "Пользователя с такой почтой нет";
    if (msg.includes("disabled") || msg.includes("banned"))
      return "Аккаунт отключён. Обратитесь к администратору.";
    if (msg.includes("rate limit"))
      return "Слишком много попыток — повторите через минуту";
    return e.message || "Не удалось войти";
  };

  const handlePasswordSignIn = async (e) => {
    e?.preventDefault?.();
    clearMessages();
    if (!isSupabaseConfigured) {
      setError("Supabase не настроен — только демо-режим");
      return;
    }
    if (!email.trim()) {
      setError("Введите почту");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Введите пароль");
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
        return;
      }
      // Успех сервера ≠ вход в приложение: если браузер не дал сохранить
      // сессию, gate не перерисуется и человек останется на форме. Раньше
      // это выглядело как вечное «Signing in…» — сервер отвечал 200, а UI
      // молчал. Ждём материализации сессии и говорим правду, если её нет.
      const appeared = await waitForSession(SESSION_WAIT_MS);
      if (!appeared) {
        setError(
          storageOk
            ? "Вход прошёл, но сессия не сохранилась. Обновите страницу; если повторится — проверьте настройки конфиденциальности браузера."
            : "Браузер не дал сохранить сессию. Отключите блокировку данных сайта или выйдите из приватного окна."
        );
      }
      // Сессия появилась — gate сам перерисует приложение.
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      // ВСЕГДА: раньше loading снимался только в ветках ошибок, и успешный
      // вход без материализации сессии оставлял спиннер навсегда.
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
      setError("Supabase не настроен — только демо-режим");
      return;
    }
    if (!email.trim()) {
      setError("Сначала введите почту");
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
    <div className="min-h-screen w-full bg-bg relative overflow-hidden flex items-center justify-center px-4 py-10 font-sans">
      {/* Декоративный background: радиальные пятна + grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 0%, rgba(200,217,111,0.12), transparent 70%), radial-gradient(ellipse 60% 60% at 50% 100%, rgba(15,23,42,0), transparent 60%)",
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
        {/* Brand mark — выезжает из темноты: круглый кроп прячет белый
            фон исходника, multi-layer glow halos (emerald + amber)
            пульсируют как «дыхание», ring + drop-shadow подсвечивают
            периметр. Без текста — лого само за себя говорит. */}
        <div className="flex items-center justify-center mb-8 relative h-40">
          {/* Глубинный slow-pulse эмеральдовый halo */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-72 rounded-full bg-success/25 blur-[90px] animate-[logoGlow_4s_ease-in-out_infinite]" />
          </div>
          {/* Тёплый amber-halo — теплит низ свирла */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-52 rounded-full bg-amber-400/20 blur-[55px]" />
          </div>
          {/* Близкий ярко-эмеральдовый rim */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-36 h-36 rounded-full bg-emerald-300/25 blur-[28px]" />
          </div>

          {/* Сам лого — круглый, ring-2 эмеральдовый, мягкая 60px тень */}
          <div
            className="relative z-10 w-36 h-36 rounded-full overflow-hidden ring-2 ring-emerald-400/40 shadow-[0_0_80px_-10px_rgba(200,217,111,0.55)] animate-[logoEmerge_900ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
            style={{ background: "radial-gradient(circle at 50% 45%, #FDFCF8 0%, #FDFCF8 60%)" }}
          >
            <img
              src="/logo.png"
              alt="coinpoint"
              className="w-full h-full object-contain p-2 select-none"
              draggable={false}
            />
          </div>
        </div>

        {/* Card */}
        <div
          className="relative bg-ink/70 backdrop-blur-xl border border-line rounded-[20px] px-7 py-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 60px -20px rgba(0,0,0,0.7)",
          }}
        >
          <header className="mb-6">
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">
              Sign in to your account
            </h1>
            <p className="text-body-sm text-muted-soft mt-1.5">
              Secure access to your cashier system
            </p>
          </header>

          {/* Проба хранилища — ДО ввода пароля. Раньше человек узнавал о
              проблеме только потратив попытку и увидев вечный спиннер. */}
          {!storageOk && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-card bg-amber-50 border border-amber-200 text-amber-700 text-caption">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" strokeWidth={2} />
              <span>
                Браузер не даёт сохранять данные сайта — вход не переживёт
                перезагрузку вкладки. Отключите блокировку данных или выйдите
                из приватного окна.
              </span>
            </div>
          )}

          {/* Notice: Supabase not configured */}
          {!isSupabaseConfigured && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-card bg-amber-50 border border-amber-200 text-amber-700 text-caption">
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
                placeholder="вы@компания.com"
                className="w-full bg-transparent outline-none text-body text-white placeholder:text-muted py-2.5 disabled:opacity-60"
              />
            </Field>

            {/* Password */}
            <Field
              icon={<Lock className="w-3.5 h-3.5" />}
              label="Пароль"
              htmlFor="password"
              className="mt-3"
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="p-1 text-muted-soft hover:text-white/80 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
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
                className="w-full bg-transparent outline-none text-body text-white placeholder:text-muted py-2.5 disabled:opacity-60"
              />
            </Field>

            {/* Alerts */}
            {(error || info) && (
              <div className="mt-4">
                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-card bg-rose-50 border border-rose-200 text-rose-700 text-caption animate-[fadeIn_200ms_ease-out]">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {info && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-card bg-success/10 border border-emerald-500/25 text-emerald-300 text-caption animate-[fadeIn_200ms_ease-out]">
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
              className={`mt-5 w-full h-11 rounded-card inline-flex items-center justify-center gap-2 font-semibold text-body transition-all ${
                loading || recoveryLoading
                  ? "bg-success/60 text-ink/60 cursor-not-allowed"
                  : "bg-gradient-to-b from-emerald-400 to-emerald-600 text-ink hover:from-emerald-300 hover:to-emerald-500 shadow-[0_8px_20px_-8px_rgba(200,217,111,0.6)] hover:shadow-[0_12px_28px_-8px_rgba(200,217,111,0.75)] active:scale-[0.99]"
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
                className="text-caption font-medium text-muted-soft hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {recoveryLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Sending recovery link…
                  </>
                ) : (
                  "Забыли пароль?"
                )}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-tiny text-muted leading-relaxed">
            Don't have an account?{" "}
            <span className="text-muted-soft">Доступ только по приглашению — попросите администратора.</span>
          </p>
        </div>

        {/* Footer */}
        <footer className="mt-8 flex flex-col items-center gap-1.5 text-tiny text-ink-soft">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-muted" />
            Secure · Private · Internal system
          </div>
          <div className="text-ink-soft">v{APP_VERSION}</div>
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
            className="mt-1 text-ink-soft hover:text-muted-soft underline underline-offset-2 transition-colors"
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
        @keyframes logoEmerge {
          from { opacity: 0; transform: scale(0.6); filter: blur(8px); }
          to   { opacity: 1; transform: scale(1);   filter: blur(0); }
        }
        @keyframes logoGlow {
          0%, 100% { opacity: 0.65; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}

// Поле — серая рамка + emerald focus-ring + inline иконка слева.
function Field({ icon, label, htmlFor, children, className = "", rightSlot }) {
  return (
    <div
      className={`group relative bg-bg/60 border border-line rounded-card px-3 pt-1.5 pb-1 transition-colors focus-within:border-emerald-500/60 focus-within:ring-4 focus-within:ring-emerald-500/10 ${className}`}
    >
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-tiny font-semibold text-muted tracking-[0.1em] uppercase"
      >
        <span className="text-muted group-focus-within:text-success transition-colors">
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
