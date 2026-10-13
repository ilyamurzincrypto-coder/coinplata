/**
 * (Волна6 9) ЕДИНЫЙ реестр действий под двойным контролем (maker-checker) — источник правды
 * для экрана «Действия под двойным контролем» в Настройках. Решение владельца: создание
 * мерчанта из-под контроля СНЯТО; остаются опасные операции (изначально two-person по A2/M4)
 * и включение агентства (автоматические комиссии = экономика платформы).
 *
 * Расширение списка (выплаты свыше суммы? изменение тарифов?) — вопрос эксперту (README),
 * пусть решает ОН; мы список не раздуваем сами.
 */
export type DualControlGroup = 'dangerous' | 'service';

export interface DualControlEntry {
  action: string;
  label: string;
  group: DualControlGroup;
  note: string;
}

export const DUAL_CONTROL_REGISTRY: readonly DualControlEntry[] = [
  { action: 'merchant.freeze', label: 'Заморозка мерчанта (приём/выплаты)', group: 'dangerous', note: 'Приостановка денежных операций участника' },
  { action: 'merchant.unfreeze', label: 'Разморозка мерчанта', group: 'dangerous', note: 'Возврат участника к работе' },
  { action: 'merchant.terminate', label: 'Терминирование мерчанта', group: 'dangerous', note: 'Полное отключение участника' },
  { action: '2fa.reset', label: 'Сброс 2FA сотрудника', group: 'dangerous', note: 'Сброс второго фактора — риск захвата доступа' },
  { action: 'agency.enable', label: 'Включение агентства', group: 'service', note: 'Автоматические комиссии с оборота — экономика платформы' },
];

export const DUAL_CONTROL_GROUP_LABEL: Record<DualControlGroup, string> = {
  dangerous: 'Опасные операции',
  service: 'Включение услуги',
};
