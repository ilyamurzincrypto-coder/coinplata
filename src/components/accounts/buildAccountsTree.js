// src/components/accounts/buildAccountsTree.js
// Чистое построение дерева «офис → валюта → счета» с итогами и разрезом по типу
// счёта (Все/Фиат/Крипто). Пустые в разрезе офисы ОСТАЮТСЯ в дереве (итог 0) —
// бухгалтеру важно видеть, что пусто. Вынесено из AccountsTree ради тестируемости.
//
// kindFilter: "all" | "fiat" | "crypto" (сверяется с account.kind).
export function buildAccountsTree({
  accounts = [],
  offices = [],
  kindFilter = "all",
  balanceOf,
  reservedOf,
  toBase,
  ccyOrder = () => 0,
}) {
  const tree = offices.map((office) => {
    const accs = accounts.filter(
      (a) => a.active && a.officeId === office.id && (kindFilter === "all" || a.kind === kindFilter)
    );
    const byCcy = {};
    accs.forEach((a) => (byCcy[a.currency] || (byCcy[a.currency] = [])).push(a));
    const ccys = Object.keys(byCcy)
      .sort((x, y) => ccyOrder(x) - ccyOrder(y))
      .map((ccy) => {
        const list = byCcy[ccy];
        const total = list.reduce((s, a) => s + balanceOf(a.id), 0);
        const reserved = list.reduce((s, a) => s + reservedOf(a.id), 0);
        // base — вклад валюты в итог офиса (в base-валюте); удобно для рендера.
        return { ccy, list, total, reserved, available: total - reserved, base: toBase(total, ccy) };
      });
    const baseTotal = ccys.reduce((s, c) => s + c.base, 0);
    return { office, ccys, baseTotal, accsCount: accs.length };
  });
  const grandBase = tree.reduce((s, o) => s + o.baseTotal, 0);
  return { tree, grandBase };
}
