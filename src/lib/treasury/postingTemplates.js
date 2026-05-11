// src/lib/treasury/postingTemplates.js
// Code-defined templates for common manual journal entries (Posting Master).
// Each template specifies one or more lines by (side, subtype). When the user
// picks a template the resolver looks up real ledger.accounts matching that
// (subtype, currency) and pre-fills the line's `accountCode` iff exactly one
// candidate exists. Ambiguous lines (multiple matches, e.g. several cash
// accounts split by office) stay empty so the accountant picks via the
// SearchableSelect.
//
// Templates are intentionally narrow — they cover the recurring entries this
// exchange business actually does (network/gas fees, owner contributions,
// FX revaluation). Generic accounting templates (rent, salary) live outside
// this chart of accounts and aren't included; add them here when matching
// accounts are introduced.

export const POSTING_TEMPLATES = [
  {
    id: "network_fee",
    name: { en: "Network fee (gas)", ru: "Сетевая комиссия (gas)", tr: "Ağ ücreti (gas)" },
    description: {
      en: "Write off a blockchain gas fee paid from a crypto wallet to expense.",
      ru: "Списать газ-комиссию с крипто-кошелька в расходы.",
      tr: "Bir kripto cüzdandan ödenen ağ ücretini gidere yaz.",
    },
    lines: [
      { side: "dr", subtype: "network_fee" },
      { side: "cr", subtype: "crypto_input" },
    ],
  },
  {
    id: "exchange_fee",
    name: { en: "Exchange/withdrawal fee", ru: "Комиссия биржи / вывода", tr: "Borsa / çekim ücreti" },
    description: {
      en: "Fee charged by an external exchange or payment provider.",
      ru: "Комиссия внешней биржи или провайдера.",
      tr: "Bir dış borsa veya ödeme sağlayıcısının kestiği ücret.",
    },
    lines: [
      { side: "dr", subtype: "exchange_fee" },
      { side: "cr", subtype: "cash" },
    ],
  },
  {
    id: "owner_contribution",
    name: { en: "Owner contribution", ru: "Вложение собственника", tr: "Sahibin katkısı" },
    description: {
      en: "Cash put into the business by an owner.",
      ru: "Деньги, которые собственник внёс в бизнес.",
      tr: "Sahibin işe koyduğu nakit.",
    },
    lines: [
      { side: "dr", subtype: "cash" },
      { side: "cr", subtype: "owner_contribution" },
    ],
  },
  {
    id: "owner_withdrawal",
    name: { en: "Owner withdrawal", ru: "Изъятие собственника", tr: "Sahibin çekimi" },
    description: {
      en: "Cash taken out of the business by an owner.",
      ru: "Деньги, которые собственник изъял из бизнеса.",
      tr: "Sahibin işten çıkardığı nakit.",
    },
    lines: [
      { side: "dr", subtype: "owner_contribution" },
      { side: "cr", subtype: "cash" },
    ],
  },
  {
    id: "fx_loss_adjustment",
    name: { en: "FX loss adjustment", ru: "Курсовая разница (убыток)", tr: "Kur farkı (zarar)" },
    description: {
      en: "Recognise an FX revaluation loss against the FX clearing account.",
      ru: "Признать курсовой убыток против счёта курсовых разниц.",
      tr: "Bir kur farkı zararını kur kliring hesabına karşı kaydet.",
    },
    lines: [
      { side: "dr", subtype: "fx_loss" },
      { side: "cr", subtype: "fx_clearing" },
    ],
  },
  {
    id: "fx_gain_adjustment",
    name: { en: "FX gain adjustment", ru: "Курсовая разница (прибыль)", tr: "Kur farkı (kâr)" },
    description: {
      en: "Recognise an FX revaluation gain against the FX clearing account.",
      ru: "Признать курсовую прибыль против счёта курсовых разниц.",
      tr: "Bir kur farkı kazancını kur kliring hesabına karşı kaydet.",
    },
    lines: [
      { side: "cr", subtype: "fx_gain" },
      { side: "dr", subtype: "fx_clearing" },
    ],
  },
];

// Resolve a template into a draft set of Posting Master lines, given the
// available chart of accounts and the entry currency. Returns one line per
// template line. If exactly one account matches `(subtype, currency, active)`
// its code is pre-filled; otherwise `accountCode` is left empty and the
// accountant disambiguates via the SearchableSelect on the row.
//
// `lineSeed` is a monotonically-increasing integer the caller passes in so
// row ids stay stable across re-renders; we mutate it via the returned `nextSeed`.
export function resolveTemplate(tpl, accounts, currency, lineSeed = 0) {
  if (!tpl || !Array.isArray(tpl.lines)) return { lines: [], nextSeed: lineSeed };
  let seed = lineSeed;
  const lines = tpl.lines.map((tl) => {
    seed += 1;
    const matches = (accounts || []).filter(
      (a) => a.subtype === tl.subtype && a.currency === currency && a.active !== false
    );
    const accountCode = matches.length === 1 ? matches[0].code : "";
    return {
      id: `pm${seed}`,
      accountCode,
      side: tl.side,
      amount: "",
      clientId: null,
      partnerId: null,
    };
  });
  return { lines, nextSeed: seed };
}
