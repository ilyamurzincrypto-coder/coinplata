// src/lib/treasury/v2selectors.js
// Pure-function selectors for Treasury Spec B. Take a `ctx` object built up
// from useLedger() + useBaseCurrency(): { accounts, balances, transactions,
// entries, toBase, baseCurrency, officeFilter, now? }.
// All office filtering happens here. "all" includes office_id IS NULL accounts;
// a specific office UUID excludes them.

function passesOfficeFilter(account, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return account.officeId === officeFilter;
}

const SUBTYPE_LABEL_KEYS = {
  cash: "trv2_subtype_cash",
  bank: "trv2_subtype_bank",
  crypto_input: "trv2_subtype_crypto_input",
  crypto_output: "trv2_subtype_crypto_output",
  inter_office: "trv2_subtype_inter_office",
  clearing: "trv2_subtype_clearing",
  fx_clearing: "trv2_subtype_fx_clearing",
  customer_liab: "trv2_subtype_customer_liab",
  partner_liab: "trv2_subtype_partner_liab",
  unearned: "trv2_subtype_unearned",
  opening_balance: "trv2_subtype_opening_balance",
  retained_earnings: "trv2_subtype_retained_earnings",
  owner_contribution: "trv2_subtype_owner_contribution",
  spread: "trv2_subtype_spread",
  commission: "trv2_subtype_commission",
  fx_gain: "trv2_subtype_fx_gain",
  fx_loss: "trv2_subtype_fx_loss",
  network_fee: "trv2_subtype_network_fee",
  exchange_fee: "trv2_subtype_exchange_fee",
};

export function groupByClass(ctx, accountType) {
  const { accounts, balances, toBase, officeFilter } = ctx;
  // balance lookup: (accountId, currency, clientId, partnerId) → balance
  const balByKey = new Map();
  for (const b of balances) {
    balByKey.set(`${b.accountId}|${b.currency}|${b.clientId || ""}|${b.partnerId || ""}`, b);
  }
  const bySubtype = new Map();
  for (const acc of accounts) {
    if (acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    // an account may have multiple balance rows (per dimension) — emit one row per
    const rowsForAccount = balances.filter((b) => b.accountId === acc.id);
    const dimRows = rowsForAccount.length > 0 ? rowsForAccount : [{ accountId: acc.id, currency: acc.currency, clientId: null, partnerId: null, balance: 0 }];
    const subtype = acc.subtype || "other";
    const sect = bySubtype.get(subtype) || { subtype, labelKey: SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other", accounts: [], totalInBase: 0 };
    for (const dr of dimRows) {
      const inBase = toBase(dr.balance, dr.currency) || 0;
      sect.accounts.push({
        accountId: acc.id, code: acc.code, name: acc.name, currency: dr.currency,
        clientId: dr.clientId || null, partnerId: dr.partnerId || null,
        balance: dr.balance, balanceInBase: inBase,
      });
      sect.totalInBase += inBase;
    }
    bySubtype.set(subtype, sect);
  }
  return [...bySubtype.values()].sort((a, b) => b.totalInBase - a.totalInBase);
}
