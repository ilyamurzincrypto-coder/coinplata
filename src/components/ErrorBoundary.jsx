// src/components/ErrorBoundary.jsx
// Защита от рантайм-ошибок в дочернем дереве. Без него React "белый экран"
// на любой uncaught exception в render. Показывает понятный fallback +
// кнопки Reload и Back to cashier.

import React from "react";

// Класс-компонент → нет useTranslation. Помощник: читаем lang из localStorage
// и маппим на hard-coded переводы (минимальный сет для error UI).
const EB_TRANSLATIONS = {
  en: {
    eb_badge: "Something went wrong",
    eb_title: "A component crashed",
    eb_hint: "The error has been logged to the browser console. You can try reloading — your form draft is preserved in session storage.",
    eb_message: "Message",
    eb_stack: "Stack trace",
    eb_try_again: "Try again",
    eb_back_home: "Back home",
    eb_reload: "Reload app",
  },
  ru: {
    eb_badge: "Что-то пошло не так",
    eb_title: "Компонент упал",
    eb_hint: "Ошибка записана в консоль браузера. Попробуйте перезагрузить — черновик формы сохранён в session storage.",
    eb_message: "Сообщение",
    eb_stack: "Стек ошибки",
    eb_try_again: "Попробовать снова",
    eb_back_home: "На главную",
    eb_reload: "Перезагрузить",
  },
  tr: {
    eb_badge: "Bir şeyler ters gitti",
    eb_title: "Bir bileşen çöktü",
    eb_hint: "Hata tarayıcı konsoluna yazıldı. Yenilemeyi deneyebilirsiniz — form taslağı session storage'da duruyor.",
    eb_message: "Mesaj",
    eb_stack: "Hata yığını",
    eb_try_again: "Tekrar dene",
    eb_back_home: "Ana sayfa",
    eb_reload: "Yeniden yükle",
  },
};

function ebText(key, fallback) {
  try {
    const lang = (localStorage.getItem("coinplata.lang") || "EN").toLowerCase();
    return EB_TRANSLATIONS[lang]?.[key] || EB_TRANSLATIONS.en[key] || fallback;
  } catch {
    return fallback;
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  reload = () => {
    window.location.reload();
  };

  goHome = () => {
    // Через location hash/search — даже если App.jsx сломан, мы выйдем со страницы
    try {
      window.location.href = window.location.pathname;
    } catch {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error) {
      const err = this.state.error;
      const stack = this.state.errorInfo?.componentStack || err.stack || "";
      return (
        <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center px-6 py-12">
          <div className="max-w-xl w-full bg-white rounded-[14px] border border-rose-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-rose-100 bg-rose-50/50">
              <div className="text-[11px] font-bold tracking-wider uppercase text-rose-600">
                {ebText("eb_badge", "Something went wrong")}
              </div>
              <h1 className="text-[20px] font-bold tracking-tight text-slate-900 mt-1">
                {ebText("eb_title", "A component crashed")}
              </h1>
              <p className="text-[12px] text-slate-600 mt-1">
                {ebText("eb_hint", "The error has been logged to the browser console.")}
              </p>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  {ebText("eb_message", "Message")}
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-[12px] font-mono text-slate-800 break-words">
                  {err.message || String(err)}
                </div>
              </div>

              {stack && (
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-900 font-semibold">
                    {ebText("eb_stack", "Stack trace")}
                  </summary>
                  <pre className="mt-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-[10px] font-mono text-slate-700 overflow-auto max-h-64">
                    {stack}
                  </pre>
                </details>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={this.reset}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                {ebText("eb_try_again", "Try again")}
              </button>
              <button
                onClick={this.goHome}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300"
              >
                {ebText("eb_back_home", "Back home")}
              </button>
              <button
                onClick={this.reload}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800"
              >
                {ebText("eb_reload", "Reload app")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
