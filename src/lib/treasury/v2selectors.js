// src/lib/treasury/v2selectors.js
// Pure-function selectors for Treasury Spec B. Take a `ctx` object built up
// from useLedger() + useBaseCurrency(): { accounts, balances, transactions,
// entries, toBase, baseCurrency, officeFilter, now? }.
// All office filtering happens here. "all" includes office_id IS NULL accounts;
// a specific office UUID excludes them.
