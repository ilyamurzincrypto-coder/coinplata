# CoinPlata — Crypto Exchange Manager Workspace

Full-featured cashier & back-office workspace for a multi-office crypto exchange. Built with Vite + React 18 + Tailwind + lucide-react. No routing library, no state management library — just React Context providers.

## Pages

- **Cashier** — live exchange form with multi-output, real-time rates, accounts, commissions, referrals, counterparties (with telegram search), transaction list with edit modal
- **Capital** — 5 tabs: Overview · Cashflow (DDS) · Income & Expense · By office · By manager. Global date range picker (Today / Week / Month / Custom).
- **Clients** — aggregated counterparty stats (deals, volume, avg ticket, LTV, monthly activity bar chart)
- **Referrals** — manager performance with referral deals and bonus calculations
- **Settings** — Supabase-style sidebar layout: General · Users · Permissions · Audit log

## Roles & Permissions

Three roles: **Admin**, **Manager**, **Accountant**. Per-user per-section permissions matrix with levels `disabled / view / edit`. Admin has full access. Managers edit only their own transactions. Accountants manage capital and income/expense.

Role switcher is NOT exposed in the header — use the Settings › Users tab to switch (admin-only), or log in as different seeded user by editing `currentUserId` in `src/store/auth.jsx`.

## Tech highlights

- **Precise money math** — all arithmetic via `utils/money.js` using minor units to avoid float drift
- **Audit log** — all mutations (create/update tx, user CRUD, rates changes, settings updates, income/expense) write to append-only log with user, IP (mock), timestamp, diff
- **i18n** — EN / RU / TR, zero dependencies
- **Edit modal** reuses the ExchangeForm component in `mode="edit"`

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

Bundle: ~84 KB gzip.

## Deploy to Vercel

```bash
git init
git add .
git commit -m "CoinPlata phase 2"
git branch -M main
git remote add origin https://github.com/<you>/coinplata.git
git push -u origin main
```

Then https://vercel.com/new → pick the repo → Deploy. Vite preset auto-detected.

## Project structure

```
src/
├── App.jsx                              # Root: providers + router guard
├── main.jsx, index.css
├── i18n/translations.jsx                # EN/RU/TR + I18nProvider
├── utils/
│   ├── money.js                         # Precise arithmetic
│   └── date.js                          # Date normalization
├── store/
│   ├── data.js                          # Seeds: offices, currencies, accounts, users, etc.
│   ├── auth.jsx                         # Users + roles + permissions helper
│   ├── permissions.jsx                  # Matrix with per-user overrides
│   ├── rates.jsx                        # FX rates + add/delete pair
│   ├── accounts.jsx                     # Office wallets & cash accounts
│   ├── transactions.jsx                 # Exchange deals
│   ├── incomeExpense.jsx                # Non-deal cashflow entries
│   └── audit.jsx                        # Append-only log
├── components/
│   ├── ui/
│   │   ├── Select.jsx
│   │   ├── SegmentedControl.jsx
│   │   ├── CurrencyTabs.jsx
│   │   ├── Modal.jsx
│   │   └── DateRangePicker.jsx          # Aviasales-style presets
│   ├── Header.jsx                       # Navigation + office switcher
│   ├── Balances.jsx
│   ├── RatesBar.jsx                     # Hover expansion + add/delete pairs
│   ├── CounterpartySelect.jsx           # Name/telegram search + add new
│   ├── ExchangeForm.jsx                 # Reusable (create/edit modes)
│   ├── EditTransactionModal.jsx
│   ├── TransactionsTable.jsx
│   └── ProfileMenu.jsx                  # Dropdown in header
└── pages/
    ├── CashierPage.jsx
    ├── CapitalPage.jsx                  # Tabs wrapper
    ├── ClientsPage.jsx
    ├── ReferralsPage.jsx
    ├── SettingsPage.jsx                 # Wrapper over SettingsLayout
    ├── capital/
    │   ├── OverviewTab.jsx
    │   ├── CashflowTab.jsx
    │   ├── IncomeExpenseTab.jsx         # With Add Income/Expense modal
    │   ├── ByOfficeTab.jsx
    │   └── ByManagerTab.jsx
    └── settings/
        ├── SettingsLayout.jsx           # Sidebar
        ├── GeneralTab.jsx
        ├── UsersTab.jsx                 # Create user with one-time password
        ├── PermissionsTab.jsx           # Per-user matrix
        └── AuditLogTab.jsx
```
