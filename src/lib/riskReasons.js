// src/lib/riskReasons.js
// Человеческие пояснения риск-причин AEGIS «как для тупых»: убираем жаргон
// («типология», «прачечная», «INFERRED») и вытаскиваем ХОП (на каком шаге грязь).
// Приоритет источника данных:
//   1) структурные поля (hop/share/... — если AEGIS их пришлёт, см. промпт);
//   2) парсинг текущего текста reason.message (формат «След к прачечной…»);
//   3) сырой message как есть.

// Что такое «чёрный список» — определение для пользователя (одно на всё приложение).
const BLACKLIST_GLOSSARY = "«Чёрный список» — кошельки, замороженные Tether (эмитентом USDT): обычно мошенники, взломы, санкции. Деньги на них заблокированы, вывести нельзя.";

// Категория «грязной» цели (AEGIS category) → человеческая формулировка + пояснение.
const TARGET_CAT = {
  blacklist: { phrase: "замороженных («чёрных») адресов", gloss: BLACKLIST_GLOSSARY },
  mixer: { phrase: "адресов-миксеров", gloss: "Миксер — сервис, который «перемешивает» монеты, чтобы скрыть их происхождение. Классический инструмент отмывания." },
  sanction: { phrase: "санкционных адресов", gloss: "Санкционные адреса — из списков OFAC (США) и др. Операции с ними запрещены законом." },
  scam: { phrase: "скам-адресов", gloss: "Скам — адреса мошеннических схем (фейк-обмены, пирамиды, фишинг)." },
  darknet: { phrase: "даркнет-адресов", gloss: "Даркнет — адреса нелегальных площадок в теневой сети." },
  no_kyc: { phrase: "бирж без верификации (KYC)", gloss: "Биржи без KYC не проверяют личность — популярны для отмывания и вывода грязных средств." },
};

// Прямые хард-факты по коду (одно-хоповые, подтверждённые).
const CODE_MAP = {
  blacklist: { tone: "critical", title: "Кошелёк заморожен", plain: "Этот кошелёк в чёрном списке Tether (эмитента USDT) — деньги на нём заблокированы. Так бывает, когда адрес связан с мошенничеством, взломом или санкциями.", glossary: null },
  sanction: { tone: "critical", title: "Под санкциями", plain: "Адрес в санкционных списках (OFAC, США). Любые операции с ним запрещены законом.", glossary: null },
  ban_pending: { tone: "critical", title: "Идёт заморозка", plain: "По кошельку уже запущена заморозка Tether — скоро средства могут заблокировать.", glossary: null },
  destroyed: { tone: "critical", title: "Скомпрометирован", plain: "Кошелёк помечен как уничтоженный или скомпрометированный — пользоваться им нельзя.", glossary: null },
  clean: { tone: "ok", title: "Чисто", plain: "Прямых риск-флагов не найдено.", glossary: null },
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

  // 1) структурные поля от AEGIS (Tier 1) — приоритет.
  const sHop = r.hop ?? null;
  const sShare = r.share ?? null;
  const sCat = r.category || null;

  // Хард-код (чистый/блэклист/санкции/…).
  if (CODE_MAP[code] && code !== "risk_factor") {
    const m = CODE_MAP[code];
    return { tone: m.tone, hop: sHop ?? 1, title: m.title, plain: m.plain, glossary: m.glossary || null, note: null, raw: r.message || null };
  }

  // 2) funder-trace: структурно (AEGIS Tier 1) либо парсингом текста (старый кэш).
  const structured = code === "funder_trace" || sShare != null;
  const ft = structured ? null : parseFunderTrace(r.message);
  if (structured || ft) {
    const hop = sHop ?? ft?.hop ?? 1;
    const share = sShare ?? ft?.share ?? null;
    const cnt = r.onward_blacklist_count ?? r.onwardBlacklistCount ?? ft?.onwardCount ?? null;
    const onwardPct = r.onward_blacklist_pct ?? r.onwardBlacklistPct ?? ft?.onwardPct ?? null;
    const inferred = r.confidence ? r.confidence !== "confirmed" : ft ? ft.inferred !== false : true;
    const inbound = (r.direction || "inbound") !== "outbound";
    const { phrase: catPhrase, gloss } = TARGET_CAT[sCat] || TARGET_CAT.blacklist;
    const sharePart = share != null
      ? `${share}% ${inbound ? "денег на этот кошелёк пришло" : "средств с этого кошелька ушло"}`
      : (inbound ? "Часть денег пришла" : "Часть средств ушла");
    const step = hop <= 1 ? "напрямую" : `через ${hop - 1} посредника`;
    const node = inbound ? "с адреса" : "на адрес";
    const onward = cnt != null
      ? `, который сам активно переводит ${onwardPct != null ? onwardPct + "% своих средств " : "деньги "}на ${cnt} ${catPhrase}`
      : `, связанного с ${catPhrase}`;
    return {
      tone: "warning",
      hop,
      title: inbound ? "Деньги пришли из «грязной» цепочки" : "Деньги ушли в «грязную» цепочку",
      plain: `${sharePart} ${step} ${node}${onward}. Похоже, через этот адрес отмывают средства.`,
      glossary: gloss,
      note: inferred
        ? "Прямого совпадения нет — это косвенный след по цепочке переводов. Стоит проверить источник."
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
