// src/lib/riskReasons.js
// Человеческие пояснения риск-причин AEGIS «как для тупых»: убираем жаргон
// («типология», «прачечная», «INFERRED») и вытаскиваем ХОП (на каком шаге грязь).
// Приоритет источника данных:
//   1) структурные поля (hop/share/... — если AEGIS их пришлёт, см. промпт);
//   2) парсинг текущего текста reason.message (формат «След к прачечной…»);
//   3) сырой message как есть.

// Прямые хард-факты по коду (одно-хоповые, подтверждённые).
const CODE_MAP = {
  blacklist: { tone: "critical", title: "Чёрный список", plain: "Кошелёк в чёрном списке эмитента USDT (Tether). Деньги на нём могут заморозить в любой момент." },
  sanction: { tone: "critical", title: "Санкции", plain: "Адрес под санкциями (OFAC). Любые операции с ним запрещены." },
  ban_pending: { tone: "critical", title: "Идёт заморозка", plain: "По кошельку уже запущена заморозка. Скоро может быть заблокирован." },
  destroyed: { tone: "critical", title: "Скомпрометирован", plain: "Кошелёк помечен как уничтоженный или скомпрометированный." },
  clean: { tone: "ok", title: "Чисто", plain: "Прямых риск-флагов не найдено." },
};

// Парсер текущего текста «След к прачечной: 48% средств от узла TJDE… (1 хоп),
// который шлёт 20% исходящего на 110 BLACKLIST-адресов — INFERRED, проверить источник».
function parseFunderTrace(message) {
  if (!message || !/прачечн|BLACKLIST|исходящ/i.test(message)) return null;
  const num = (re) => { const m = message.match(re); return m ? Number(m[1]) : null; };
  const share = num(/(\d+)%\s*средств/);
  const hop = num(/\((\d+)\s*хоп/);
  const onwardPct = num(/шлёт\s*(\d+)%/);
  const onwardCount = num(/на\s*(\d+)\s*BLACKLIST/i);
  const addrM = message.match(/узла\s+([A-Za-z0-9]{20,})/);
  const inferred = /INFERRED/i.test(message);
  if (share == null && onwardCount == null) return null;
  return { share, hop: hop ?? 1, onwardPct, onwardCount, sourceAddress: addrM ? addrM[1] : null, inferred };
}

// Метка хопа для UI. 1 = прямой источник, 2 = через посредника, дальше — по числу.
export function hopLabel(hop) {
  if (hop == null) return null;
  if (hop <= 1) return "1-й хоп · прямой источник";
  if (hop === 2) return "2-й хоп · через 1 посредника";
  return `${hop}-й хоп · через ${hop - 1} посредника`;
}

// reason → { tone, hop, title, plain, note, raw }. Никогда не бросает.
export function plainReason(reason) {
  if (!reason) return null;
  const r = typeof reason === "string" ? { message: reason } : reason;
  const code = r.code || "";

  // 1) структурные поля от AEGIS (если появятся) — приоритет.
  const sHop = r.hop ?? null;
  const sShare = r.share ?? null;
  const sCat = r.category || null;

  // Хард-код (чистый/блэклист/санкции/…).
  if (CODE_MAP[code] && code !== "risk_factor") {
    return { tone: CODE_MAP[code].tone, hop: sHop ?? 1, title: CODE_MAP[code].title, plain: CODE_MAP[code].plain, note: null, raw: r.message || null };
  }

  // 2) funder-trace: структурно либо парсингом текста.
  const ft = parseFunderTrace(r.message);
  if (ft || sShare != null || sCat === "funder_trace") {
    const hop = sHop ?? ft?.hop ?? 1;
    const share = sShare ?? ft?.share ?? null;
    const cnt = r.onwardBlacklistCount ?? ft?.onwardCount ?? null;
    const onwardPct = r.onwardBlacklistPct ?? ft?.onwardPct ?? null;
    const inferred = r.confidence ? r.confidence !== "confirmed" : ft?.inferred !== false;
    const sharePart = share != null ? `${share}% денег на этом кошельке` : "Часть денег";
    const via = hop <= 1 ? "пришло напрямую с адреса" : `пришло через ${hop - 1} посредника с адреса`;
    const onward = cnt != null
      ? `, который сам отправляет ${onwardPct != null ? onwardPct + "% средств " : ""}на ${cnt} адресов из чёрного списка`
      : ", связанного с чёрным списком";
    return {
      tone: "warning",
      hop,
      title: "След к чёрному списку",
      plain: `${sharePart} ${via}${onward}.`,
      note: inferred
        ? "Это предположение по цепочке переводов (не прямое совпадение) — стоит проверить источник средств."
        : "Связь подтверждена.",
      raw: r.message || null,
    };
  }

  // 3) фолбэк — сырой текст.
  return { tone: code && CODE_MAP[code] ? CODE_MAP[code].tone : "warning", hop: sHop, title: r.title || "Риск-фактор", plain: r.message || "Причина без описания.", note: null, raw: r.message || null };
}

// Список причин → плейн-объекты, «clean» отфильтрован (не показываем как проблему).
export function plainReasons(reasons) {
  return (Array.isArray(reasons) ? reasons : [])
    .filter((r) => (typeof r === "string" ? true : r?.code !== "clean"))
    .map(plainReason)
    .filter(Boolean);
}
