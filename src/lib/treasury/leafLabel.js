// src/lib/treasury/leafLabel.js
// Короткий лейбл листа дерева Казначейства (Активы/Пассивы). Имена счетов в
// плане счетов имеют вид «Cash · Istanbul · USD», «Hot · USDT TRC20 · Istanbul»,
// «Customer Liab · USD» — где офис уже показан в заголовке группы, а валюта в
// своей колонке. Чтобы не дублировать, вырезаем токены офиса и валюты:
//   - остаётся один токен (тип счёта) → локализованный подтип (t(`trv2_subtype_*`)):
//     «Касса», «Банк», «Обязательства перед клиентами», …
//   - остаётся различитель (напр. сеть крипто) → оставляем его: «Hot · TRC20».
// Капитал намеренно НЕ использует этот хелпер — там другой формат имён.
//
// @param {{name, subtype, currency, officeName?}} a
// @param {(key:string)=>string} t  — i18n-функция (useTranslation().t)
export function leafLabel(a, t) {
  const ccy = a.currency || "";
  const officeName = a.officeName || "";
  const kept = [];
  for (const raw of String(a.name || "").split("·")) {
    const tok = raw.trim();
    if (!tok || (officeName && tok === officeName)) continue;
    // валюту вырезаем как отдельное слово внутри токена (USDT не цепляет USD)
    const cleaned = tok.split(/\s+/).filter((w) => w !== ccy).join(" ").trim();
    if (cleaned) kept.push(cleaned);
  }
  if (kept.length <= 1 && a.subtype) {
    const key = `trv2_subtype_${a.subtype}`;
    const tr = t(key);
    if (tr && tr !== key) return tr; // есть перевод подтипа — отдаём его
  }
  return kept.join(" · ") || a.name; // различитель (сеть) или fallback на полное имя
}
