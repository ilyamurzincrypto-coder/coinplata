// src/lib/treasury/selectors.js
// Pure-function selectors for Treasury Dashboard MVP.
//
// Each takes a `ctx` object built up from hook outputs:
//   { officeId, accounts, movements, obligations, transactions,
//     rates, lastConfirmedAt, modifiedAfterConfirmation,
//     balanceOf, reservedOf, toBase, baseCurrency, now? }
//
// All filtering by officeId happens here so subcomponents stay dumb.
// `now` is optional injectable Date factory for tests; defaults to Date.now.
