# CoinPlata

A multi-office crypto exchange cashier workspace built with React + Vite + Tailwind.

**Bundle**: ~92 KB gzip · **Dependencies**: React 18, Tailwind, lucide-react, Vite · **No backend required for demo** — all state is client-side.

## Features

### Exchange (Cashier)
- Multi-currency exchange form (USDT / USD / EUR / TRY / GBP)
- Multi-output with "Convert remaining amount here"
- Reverse button between RECEIVED and ISSUED
- Min fee indicator with auto-apply
- Searchable account selector for each output
- Non-blocking warnings if accounts not selected
- Real-time remaining amount calculation (`amountIn − outputs − fee >= 0`)
- Reference rates with manual/auto toggle per output

### Accounts (Movement engine)
- Office → Accounts hierarchy
- Top up · Transfer · History per account
- Cross-currency transfers with rate
- **Computed balances** from `movements[]` (no static data)
- Exchange transactions automatically write `exchange_in` / `exchange_out` movements
- Edit transaction rewrites movements (simple `removeByRefId` + re-add)
- Income/Expense also writes movements

### Capital
- Overview · Cashflow DDS · Income/Expense · By office · By manager
- Global date range picker (Today / Week / Month / Custom)
- All metrics in selectable **Base Currency** (USD / USDT / EUR / TRY)

### Clients
- Aggregated counterparty stats: deals, volume, avg ticket, LTV
- Monthly activity bar chart
- Search by name / telegram

### Settings (Supabase-style sidebar)
- **General** — min fee, referral %, rates, base currency selector
- **Users** — roles (Admin / Manager / Accountant), active/inactive toggle, create with one-time password
- **Permissions** — per-user per-section matrix (Disabled / View / Edit)
- **Audit log** — append-only, searchable, with IP and user attribution

### Referrals
- Manager performance tracking with referral bonus calculations in base currency

### i18n
- English · Russian · Turkish — all UI strings through `t()`

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build       # produces dist/
npm run preview     # serve dist locally
```

## Deploy

### Vercel (recommended)

1. Push this folder to GitHub
2. Go to https://vercel.com/new
3. Import the repo → framework auto-detected as **Vite**
4. Deploy

The included `vercel.json` already has SPA rewrite configured.

### Netlify

1. Push to GitHub
2. Go to https://app.netlify.com/start
3. Connect repo
4. Build settings are auto-picked from `netlify.toml` — no manual config needed

If not auto-picked:
- Build command: `npm run build`
- Publish directory: `dist`

### Environment variables

**None required.** The demo runs entirely client-side with seed data. When integrating a backend, add `VITE_API_URL` etc. to `.env` and Vercel/Netlify project settings.

## Tech Stack

- Vite 5 + React 18
- Tailwind CSS 3
- lucide-react (icons)
- No state management library — React Context providers
- No routing library — `useState` for page switching

## Project Structure

```
src/
├── App.jsx                              # Providers + page router with permission guards
├── main.jsx
├── index.css
├── i18n/translations.jsx                # EN/RU/TR dictionary
├── utils/
│   ├── money.js                         # Precise minor-unit arithmetic, computeRemaining
│   ├── convert.js                       # Universal currency convert(amount, from, to)
│   ├── date.js                          # Date helpers
│   └── exchangeMovements.js             # Pure helper: tx → movements[]
├── store/
│   ├── data.js                          # Seed data (offices, currencies, accounts, users)
│   ├── auth.jsx                         # Users, roles, settings (minFeeUsd, referralPct, baseCurrency)
│   ├── permissions.jsx                  # Per-user per-section matrix
│   ├── rates.jsx                        # FX rates with featured pairs
│   ├── baseCurrency.js                  # Hook useBaseCurrency() composition
│   ├── accounts.jsx                     # Accounts + movements + transfers + computed balances
│   ├── transactions.jsx                 # Exchange deals
│   ├── incomeExpense.jsx                # Non-deal cashflow entries
│   └── audit.jsx                        # Append-only log with user/IP
├── components/
│   ├── ui/
│   │   ├── Modal.jsx
│   │   ├── Select.jsx
│   │   ├── SegmentedControl.jsx
│   │   ├── CurrencyTabs.jsx
│   │   └── DateRangePicker.jsx
│   ├── Header.jsx                       # Nav filtered by permissions
│   ├── ProfileMenu.jsx
│   ├── Balances.jsx                     # Uses computed balances via accounts store
│   ├── RatesBar.jsx
│   ├── ExchangeForm.jsx                 # Reusable (create/edit modes)
│   ├── EditTransactionModal.jsx         # Rewrites movements on edit
│   ├── TransactionsTable.jsx
│   ├── CounterpartySelect.jsx
│   ├── AccountSelect.jsx                # Searchable dropdown used in Exchange & Transfer
│   └── accounts/
│       ├── TopUpModal.jsx
│       ├── TransferModal.jsx
│       └── AccountHistoryModal.jsx
└── pages/
    ├── CashierPage.jsx                  # Writes exchange movements
    ├── CapitalPage.jsx                  # Tabs wrapper
    ├── AccountsPage.jsx                 # Office → Accounts layout
    ├── ClientsPage.jsx
    ├── ReferralsPage.jsx
    ├── SettingsPage.jsx
    ├── capital/
    │   ├── OverviewTab.jsx
    │   ├── CashflowTab.jsx
    │   ├── IncomeExpenseTab.jsx
    │   ├── ByOfficeTab.jsx
    │   └── ByManagerTab.jsx
    └── settings/
        ├── SettingsLayout.jsx
        ├── GeneralTab.jsx
        ├── UsersTab.jsx
        ├── PermissionsTab.jsx
        └── AuditLogTab.jsx
```

## Key architectural notes

- **Balance engine** — balances are computed from `movements[]`, not stored. All money flows (exchange, top up, transfer, income/expense) write movements with explicit `direction: "in" | "out"`, `currency`, and `source.refId`.
- **Base currency** — `settings.baseCurrency` drives all aggregated metrics (Capital, Referrals, Clients LTV). Transaction data stays in USD for `profit`/`fee`; display goes through `useBaseCurrency().toBase()`.
- **No auto-pick** — exchange movements require explicit `accountId` per output. If missing, a non-blocking warning appears and no movement is written.
- **Edit transaction** — rewrites movements (`removeMovementsByRefId(tx.id)` then re-build). Simple approach without compensating entries; sufficient for small-scale workflows.
- **Permissions** — menu items are filtered by `useCan(section)` returning true if role-default or user-override grants access.

## Seed data

- **Offices**: Mark Antalya · Terra City · Istanbul
- **Currencies**: USDT, USD, EUR, TRY, GBP
- **Accounts**: 12 pre-configured across offices with realistic opening balances
- **Users**: 5 seed users (admin/manager/accountant) — current user is `E. Kara` (admin)
