import { cn } from '@/lib/cn';

/**
 * Чип статуса: ВСЕГДА цвет + слово, никогда только цвет.
 * Пульсирующая точка — ТОЛЬКО у «Ожидает» (invoice.pending).
 */

export type ChipKind = 'invoice' | 'merchant' | 'kyb' | 'case' | 'severity' | 'identification';

interface ChipMeta {
  label: string;
  /** Классы фона/текста чипа. */
  className: string;
  /** Классы цвета точки. */
  dot: string;
  pulse?: boolean;
}

const NEUTRAL: ChipMeta = {
  label: '',
  className: 'border border-line bg-card text-ink-2',
  dot: 'bg-ink-3',
};

const MAPS: Record<ChipKind, Record<string, ChipMeta>> = {
  invoice: {
    pending: { label: 'Ожидает', className: 'bg-green-tint text-ink', dot: 'bg-green', pulse: true },
    paid: { label: 'Оплачен', className: 'bg-success-tint text-success', dot: 'bg-success' },
    declined: { label: 'Отклонён', className: 'bg-danger-tint text-danger', dot: 'bg-danger' },
    refunded: { label: 'Возврат', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    expired: { label: 'Истёк', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
    /**
     * (Разделение оплаты и расчёта) Ключи от `invoiceChipStatus`. Оплата по QR, зафиксированная
     * кассой, — ЗАКОНЧЕННОЕ событие: клиент заплатил, касса приняла. Прежде этот чип читался
     * «Зафиксирована · в пути» и тащил в статус платежа наш расчёт с провайдером — два разных
     * события в одном слове. Расчёт теперь говорит сам за себя отдельной строкой.
     */
    qr_paid: { label: 'Оплачена', className: 'bg-success-tint text-success', dot: 'bg-success' },
    // «Истекла» (30 минут без фиксации, деньги могли прийти позже) ≠ «Отменена кассой» (сделки не было).
    qr_expired: { label: 'Истекла', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
    qr_cancelled: { label: 'Отменена кассой', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
  },
  merchant: {
    // (Блок 1) Статус словом, а не только цветом: оператор должен читать «чего не хватает».
    draft: { label: 'Правила не заданы', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    pending_kyb: { label: 'На проверке', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    active: { label: 'Активен', className: 'bg-success-tint text-success', dot: 'bg-success' },
    frozen_payouts: { label: 'Выплаты заморожены', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    frozen_all: { label: 'Заморожен', className: 'bg-danger-tint text-danger', dot: 'bg-danger' },
    terminated: { label: 'Расторгнут', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
  },
  kyb: {
    new: { label: 'Новая', className: 'bg-green-tint text-ink', dot: 'bg-green' },
    in_review: { label: 'На проверке', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    docs_requested: { label: 'Запрошены документы', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    approved: { label: 'Одобрена', className: 'bg-success-tint text-success', dot: 'bg-success' },
    declined: { label: 'Отклонена', className: 'bg-danger-tint text-danger', dot: 'bg-danger' },
  },
  case: {
    open: { label: 'Открыт', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    in_progress: { label: 'В работе', className: 'bg-green-tint text-ink', dot: 'bg-green' },
    resolved: { label: 'Решён', className: 'bg-success-tint text-success', dot: 'bg-success' },
    false_positive: { label: 'Ложное срабатывание', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
  },
  severity: {
    high: { label: 'Срочно', className: 'bg-danger-tint text-danger', dot: 'bg-danger' },
    medium: { label: 'Внимание', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    low: { label: 'Низкий', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
  },
  identification: {
    none: { label: 'Не идентиф.', className: 'border border-line bg-card text-ink-3', dot: 'bg-ink-3' },
    simplified: { label: 'Упрощённая', className: 'bg-warn-tint text-warn', dot: 'bg-warn' },
    full: { label: 'Полная', className: 'bg-success-tint text-success', dot: 'bg-success' },
  },
};

export interface StatusChipProps {
  status: string;
  kind?: ChipKind;
  className?: string;
}

export function StatusChip({ status, kind = 'invoice', className }: StatusChipProps) {
  const meta: ChipMeta = MAPS[kind][status] ?? { ...NEUTRAL, label: status };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-medium leading-5',
        meta.className,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot, meta.pulse && 'animate-pulse-dot')}
      />
      {meta.label}
    </span>
  );
}
