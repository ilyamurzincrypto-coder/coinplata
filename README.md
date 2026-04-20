# CoinPlata — Crypto Exchange Cashier

Rich single-page app for crypto exchange office managers. Built with Vite + React 18 + Tailwind.

## Features

- **4 pages**: Cashier, Capital, Referrals, Settings
- **Roles**: Admin / Manager (admin-only rates editing, managers can edit only their own transactions)
- **iOS-style office switcher** — Mark Antalya / Terra City / Istanbul
- **Balance scope toggle** — selected office vs aggregated across all
- **Rates system** — live FX rates, auto-applied to exchange form, manual override per output
- **Multi-output exchange** — receive one currency, issue multiple currencies in one deal
- **Edit transaction modal** — reuses the exchange form in `mode="edit"`
- **i18n** — EN / RU / TR, zero dependencies
- **Precise money math** — integer minor units, no float rounding drift
- **Min commission** — auto-applies $10 floor
- **Referral system** — checkbox in form, bonus tracking on Referrals page
- **Counterparties** — autocomplete + free typing, stored across transactions

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel via GitHub

```bash
git init
git add .
git commit -m "CoinPlata v2"
git branch -M main
git remote add origin https://github.com/<you>/coinplata.git
git push -u origin main
```

Then on https://vercel.com/new — pick the repo, Vercel auto-detects Vite, click Deploy.

## Project structure

```
src/
├── App.jsx                            # Root: providers + router
├── main.jsx                           # React entry
├── index.css                          # Tailwind
├── i18n/translations.jsx               # EN/RU/TR + I18nProvider + useTranslation
├── store/
│   ├── data.js                        # Static mocks (offices, currencies, seeds)
│   ├── rates.jsx                      # RatesProvider + useRates
│   ├── auth.jsx                       # AuthProvider + roles + permissions
│   └── transactions.jsx               # TransactionsProvider
├── utils/money.js                     # Precise arithmetic (minor units)
├── components/
│   ├── ui/
│   │   ├── Select.jsx
│   │   ├── SegmentedControl.jsx
│   │   ├── CurrencyTabs.jsx
│   │   └── Modal.jsx
│   ├── Header.jsx                     # Navigation + office + role switcher
│   ├── Balances.jsx
│   ├── RatesBar.jsx                   # Live rates strip + edit modal
│   ├── ExchangeForm.jsx               # Reusable form (mode="create"|"edit")
│   ├── EditTransactionModal.jsx       # Wraps ExchangeForm
│   └── TransactionsTable.jsx
└── pages/
    ├── CashierPage.jsx
    ├── CapitalPage.jsx
    ├── ReferralsPage.jsx
    └── SettingsPage.jsx
```

## Architecture notes

- **No router library** — page state is a single `useState("cashier" | "capital" | ...)` in `App.jsx`. Swap for React Router when hooking up real URLs.
- **No state library** — four React Context providers (`I18n`, `Auth`, `Rates`, `Transactions`). Each exposes a hook.
- **Permissions** — `useAuth().canEditTransaction(tx)` is the single source of truth. Admin can edit everything, manager only their own.
- **Money** — all arithmetic goes through `utils/money.js` to avoid float errors. Store values as plain numbers in state, but compute via `multiplyAmount` / `percentOf`.
