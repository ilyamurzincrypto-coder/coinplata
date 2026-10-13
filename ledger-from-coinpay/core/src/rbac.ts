/**
 * RBAC для сотрудников платформы: матрица прав по ДЕЙСТВИЯМ,
 * не по разделам интерфейса.
 *
 * 🔴 `impersonate.merchant` — право ВОЙТИ ПОД УЧАСТНИКОМ, и держит его только `admin`.
 * Отдельной кнопки «войти как мерчант» в системе нет, но выдача и перевыдача пароля кабинета
 * равна ей по последствиям: пароль показывается сотруднику на экране (другого способа доставки в
 * проекте нет), и дальше он входит владельцем — заказывает выплату, меняет реквизиты и курсы.
 * Поэтому все четыре двери выдачи паролей спрашивают именно это право, а у `risk_officer` и
 * `support` его больше нет: их работа — проверки и переписка, а не вход под клиентом.
 *
 * 🔴 `invoice.create` — выставление реального счёта (QR до 10 000 000 ₽) ЛЮБОМУ мерчанту.
 * Проверки не было вовсе: форма в «Операциях» рисовалась всем, и `support` мог выставить счёт на
 * чужого мерчанта. Право у `admin` и `finance`.
 */

export type EmployeeRole = 'admin' | 'risk_officer' | 'finance' | 'support';

export type Action =
  | 'invoice.create'
  | 'merchant.freeze'
  | 'merchant.unfreeze'
  | 'merchant.terminate'
  | 'merchant.edit'
  | 'kyb.decide'
  | 'kyb.approve_override'
  | 'refund.create'
  | 'tariff.change'
  | 'payout.create'
  | 'risk.case.manage'
  | 'watchlist.edit'
  | 'employee.manage'
  | 'employee.create'
  | 'agent.create'
  | 'merchant.create'
  | 'audit.read'
  | 'reconciliation.resolve'
  | 'bank_request.manage'
  | 'impersonate.merchant';

const ALL_ACTIONS: ReadonlyArray<Action> = [
  'invoice.create',
  'merchant.freeze',
  'merchant.unfreeze',
  'merchant.terminate',
  'merchant.edit',
  'kyb.decide',
  'kyb.approve_override',
  'refund.create',
  'tariff.change',
  'payout.create',
  'risk.case.manage',
  'watchlist.edit',
  'employee.manage',
  'employee.create',
  'agent.create',
  'merchant.create',
  'audit.read',
  'reconciliation.resolve',
  'bank_request.manage',
  'impersonate.merchant',
];

export const MATRIX: Record<EmployeeRole, ReadonlyArray<Action>> = {
  admin: ALL_ACTIONS,
  risk_officer: [
    'merchant.freeze',
    'merchant.unfreeze',
    'merchant.terminate',
    'kyb.decide',
    'kyb.approve_override',
    'risk.case.manage',
    'watchlist.edit',
    'audit.read',
    // Онбординг мерчанта — комплаенс-функция.
    'merchant.create',
  ],
  finance: [
    'invoice.create',
    'payout.create',
    'tariff.change',
    'reconciliation.resolve',
    'refund.create',
    'audit.read',
  ],
  support: ['refund.create', 'bank_request.manage', 'audit.read', 'merchant.create'],
};

export function can(role: EmployeeRole | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role].includes(action);
}

/**
 * Второе подтверждение maker-checker (создание участников, сброс 2FA и т.п.):
 * подтвердить может ТОЛЬКО другой сотрудник (не автор) с правом на это действие.
 * Единая точка запрета self-confirm для всех create-действий.
 */
export function canSecondApprove(
  makerId: string,
  checker: { id: string; role: EmployeeRole; createdBy?: string | null },
  action: Action,
  /** Кем заведён АВТОР запроса — чтобы поймать и обратный случай. */
  makerCreatedBy?: string | null,
): boolean {
  if (checker.id === makerId) return false;
  /**
   * 🔴 ВТОРОЙ ЧЕЛОВЕК, А НЕ ВТОРАЯ УЧЁТКА.
   *
   * Под двойной контроль поставлена только роль `admin`; остальных сотрудников заводят
   * одношагово, и временный пароль показывают создателю. Значит один админ за минуту делает себе
   * вторую личность, входит ею и подтверждает свои же запросы — заморозку, выплату, сброс 2FA.
   * Формально это разные `id`, и прежняя проверка «не сам себя» их пропускала.
   *
   * Различает их ровно один факт: кто кого завёл. Подтверждать не может ни тот, кого создал
   * автор запроса, ни тот, кто создал самого автора. Неизвестное авторство (NULL у заведённых до
   * миграции 0090) правило не ужесточает — выдумывать его задним числом нельзя.
   */
  if (checker.createdBy && checker.createdBy === makerId) return false;
  if (makerCreatedBy && makerCreatedBy === checker.id) return false;
  return can(checker.role, action);
}


/**
 * 🔴 ТУПИК ПЕРВОЙ ПАРЫ АДМИНИСТРАТОРОВ.
 *
 * Создание роли `admin` требует подтверждения вторым сотрудником, а подтвердить его может только
 * тот, у кого есть право `employee.create` — то есть сам `admin`. Пока администратор один, он не
 * может завести второго НИКАК: себя подтверждать нельзя. Упёрлись в это на боевом 13.10, когда
 * владельцу понадобилось дать полный доступ коллеге.
 *
 * Запрет при этом ничего не охранял. Единственный админ и так может всё — выплаты, заморозки,
 * тарифы, доступы. Требовать от него подписи несуществующего человека — не безопасность, а
 * паралич: система, которая не умеет завести второго ответственного, обречена навсегда остаться
 * с одним.
 *
 * Поэтому очередь обязательна только тогда, когда ПОДТВЕРДИТЬ РЕАЛЬНО ЕСТЬ КОМУ. Как только
 * администраторов становится двое, правило возвращается в полную силу само — без флагов и
 * переключателей, которые забывают выключить.
 *
 * @param role роль создаваемого сотрудника
 * @param possibleConfirmers сколько ЖИВЫХ сотрудников (кроме автора) могут подтвердить
 */
export function creationNeedsSecondApproval(role: EmployeeRole, possibleConfirmers: number): boolean {
  if (role !== 'admin') return false; // прочие роли заводятся в один шаг, как и раньше
  return possibleConfirmers > 0;
}

/**
 * Роли, чьи обладатели могут подтвердить действие. Из матрицы, а не из памяти: выдадут право
 * кому-то ещё — ответ изменится сам, без правки списков по коду.
 */
export function rolesThatCan(action: Action): EmployeeRole[] {
  return (Object.keys(MATRIX) as EmployeeRole[]).filter((r) => can(r, action));
}

/** Роли, чьи обладатели могут подтвердить создание сотрудника. */
export function rolesThatCanConfirmEmployeeCreation(): EmployeeRole[] {
  return rolesThatCan('employee.create');
}

/**
 * Действия, требующие подтверждения вторым сотрудником (dual control).
 * Пороговые суммы для refund/payout — уровень приложения.
 */
export const DUAL_CONTROL: ReadonlySet<Action> = new Set<Action>([
  'merchant.freeze',
  'merchant.unfreeze',
  'merchant.terminate',
  'kyb.approve_override',
  'payout.create',
  'refund.create',
]);

export function requiresDualControl(action: Action): boolean {
  return DUAL_CONTROL.has(action);
}
