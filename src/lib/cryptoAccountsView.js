// src/lib/cryptoAccountsView.js
// Чистая логика раздела «Счета · Крипто» (без React) — общая для authed-кассы и
// публичной share-страницы. Классификация проблемный/ok/нулевой, фильтры-сегменты,
// порог расхождения, сортировка (проблемные сверху), группировка по офисам, итоги.
// Деньги-инвариант: on-chain (balanceUsdEst) — строка из AEGIS, в Number коэрсим
// только для порога/вывода; в леджер не ходит.

// Порог |он-чейн − учёт| (USD), выше которого кошелёк попадает в «Внимание».
export const DELTA_ALERT_THRESHOLD_USD = 1;

// Drill-down (экран деталей, движения) — ТОЛЬКО в authed-кассе. На публичной
// share-ссылке кошельки не кликабельны и детали недоступны (сервер: detail-
// эндпоинт под requireStaff, share-токен туда не проходит). Флаг — чтобы
// включить одним переключением, когда решим открыть drill-down на share.
export const SHARE_DRILLDOWN = false;

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// account + учётный остаток (USD) → view-model одного кошелька.
export function walletVM(account, ledgerUsd) {
  const onchain = num(account?.balanceUsdEst); // null = данных нет (не 0)
  const ledger = num(ledgerUsd) ?? 0;
  const hasOnchain = onchain != null;
  const delta = hasOnchain ? onchain - ledger : null; // он-чейн − учёт (знак для вывода)
  const deltaAbs = delta == null ? 0 : Math.abs(delta);
  const level = account?.riskLevel || null; // ok|warning|critical|null
  const notOk = level === "warning" || level === "critical";
  return {
    id: account?.id,
    account,
    name: account?.name || account?.id,
    address: account?.address || null,
    network: account?.network || account?.networkId || null,
    riskLevel: level,
    capability: account?.aegisCapability || account?.capability || null,
    connected: !!(account?.aegisWalletId || account?.aegis_wallet_id),
    onchain, // number | null
    ledger, // number
    hasOnchain,
    delta, // number | null (он-чейн − учёт)
    deltaAbs,
    notOk,
  };
}

// Категория кошелька для сортировки/сегментов.
//   'problem' — риск не-ok ИЛИ расхождение выше порога
//   'zero'    — нулёвка (он-чейн≈0 и учёт 0) и не проблемный
//   'ok'      — чистый с остатком
export function classifyWallet(vm, threshold = DELTA_ALERT_THRESHOLD_USD) {
  if (vm.notOk || (vm.hasOnchain && vm.deltaAbs > threshold)) return "problem";
  if ((vm.onchain ?? 0) === 0 && vm.ledger === 0) return "zero";
  return "ok";
}

// Полная модель раздела для рендера.
// items: [{ account, ledgerUsd }]  (account уже отфильтрован до крипты)
// filter: 'all' | 'attention' | 'ok'
export function buildCryptoView({ items = [], offices = [], threshold = DELTA_ALERT_THRESHOLD_USD, filter = "all" } = {}) {
  const vms = items.map(({ account, ledgerUsd }) => {
    const vm = walletVM(account, ledgerUsd);
    vm.category = classifyWallet(vm, threshold);
    return vm;
  });

  // Итоги (по всем, не по фильтру).
  const totals = vms.reduce(
    (acc, v) => {
      acc.onchain += v.onchain ?? 0;
      acc.ledger += v.ledger;
      return acc;
    },
    { onchain: 0, ledger: 0 }
  );
  totals.delta = totals.onchain - totals.ledger;

  // Счётчики сегментов.
  const counts = {
    all: vms.length,
    attention: vms.filter((v) => v.category === "problem").length,
    ok: vms.filter((v) => v.category !== "problem").length, // ok + zero
  };

  // Фильтрация под сегмент.
  const passFilter = (v) => {
    if (filter === "attention") return v.category === "problem";
    if (filter === "ok") return v.category !== "problem";
    return true;
  };
  const shown = vms.filter(passFilter);

  // Группировка по офисам. Порядок офисов — как в offices[]; пустые (в наборе) не рендерим.
  const officeById = new Map((offices || []).map((o) => [o.id, o]));
  const byOffice = new Map();
  for (const v of shown) {
    const oid = v.account?.officeId || v.account?.office_id || "—";
    if (!byOffice.has(oid)) byOffice.set(oid, []);
    byOffice.get(oid).push(v);
  }

  const rank = { problem: 0, ok: 1, zero: 2 };
  const sections = [];
  const orderedOfficeIds = [
    ...offices.map((o) => o.id).filter((id) => byOffice.has(id)),
    ...[...byOffice.keys()].filter((id) => !officeById.has(id)), // офисы вне справочника — в конец
  ];
  for (const oid of orderedOfficeIds) {
    const list = byOffice.get(oid) || [];
    // проблемные сверху, затем ok, затем нулевые; внутри — по он-чейн убыв.
    list.sort((a, b) => rank[a.category] - rank[b.category] || (b.onchain ?? 0) - (a.onchain ?? 0));
    const wallets = list.filter((v) => v.category !== "zero");
    const zeroWallets = list.filter((v) => v.category === "zero");
    const onchainSum = list.reduce((s, v) => s + (v.onchain ?? 0), 0);
    sections.push({
      office: officeById.get(oid) || { id: oid, name: oid },
      wallets,
      zeroWallets,
      onchainSum,
      count: list.length,
    });
  }

  // Офисы вообще без крипто-счетов (для подписи «Без счетов: …»).
  const officesWithAccounts = new Set(vms.map((v) => v.account?.officeId || v.account?.office_id));
  const emptyOffices = (offices || []).filter((o) => !officesWithAccounts.has(o.id)).map((o) => o.name);

  const zeroTotal = vms.filter((v) => v.category === "zero").length;

  return { totals, counts, sections, emptyOffices, zeroTotal, filter, threshold };
}
