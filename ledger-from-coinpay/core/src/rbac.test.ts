import { describe, it, expect } from 'vitest';
import { can, canSecondApprove, requiresDualControl, MATRIX, type Action, creationNeedsSecondApproval, rolesThatCan, rolesThatCanConfirmEmployeeCreation } from './rbac';

const ALL_ACTIONS = MATRIX.admin;

describe('can', () => {
  it('admin может всё', () => {
    for (const action of ALL_ACTIONS) {
      expect(can('admin', action)).toBe(true);
    }
  });

  it('support НЕ может employee.manage и kyb.decide', () => {
    expect(can('support', 'employee.manage')).toBe(false);
    expect(can('support', 'kyb.decide')).toBe(false);
  });

  it('support может свои действия', () => {
    expect(can('support', 'refund.create')).toBe(true);
    expect(can('support', 'bank_request.manage')).toBe(true);
  });

  /**
   * 🔴 Вход под участником — только админу. Отдельной кнопки «войти как мерчант» нет, но выдача
   * и перевыдача пароля кабинета равны ей: пароль показывается сотруднику на экране, и дальше он
   * распоряжается деньгами владельца. Раньше право было у трёх ролей из четырёх и не
   * проверялось НИГДЕ.
   */
  it('🔴 под участником входит только admin', () => {
    expect(can('admin', 'impersonate.merchant')).toBe(true);
    expect(can('support', 'impersonate.merchant')).toBe(false);
    expect(can('risk_officer', 'impersonate.merchant')).toBe(false);
    expect(can('finance', 'impersonate.merchant')).toBe(false);
  });

  /** Выставление реального счёта до 10 млн ₽ любому мерчанту — не работа поддержки. */
  it('🔴 счёт выставляют admin и finance, не support и не risk_officer', () => {
    expect(can('admin', 'invoice.create')).toBe(true);
    expect(can('finance', 'invoice.create')).toBe(true);
    expect(can('support', 'invoice.create')).toBe(false);
    expect(can('risk_officer', 'invoice.create')).toBe(false);
  });

  /**
   * 🔴 Вторая УЧЁТКА не делает второго ЧЕЛОВЕКА. Админ заводит сотрудника одношагово, видит его
   * временный пароль, входит им и подтверждает свои же запросы. Разные `id` прежнюю проверку
   * «не сам себя» проходили.
   */
  describe('второй подтверждающий', () => {
    const maker = 'a-maker';
    it('сам себя — нельзя, как и раньше', () => {
      expect(canSecondApprove(maker, { id: maker, role: 'admin' }, 'merchant.freeze')).toBe(false);
    });
    it('посторонний с правом — можно', () => {
      expect(canSecondApprove(maker, { id: 'b', role: 'admin', createdBy: 'кто-то-третий' }, 'merchant.freeze')).toBe(true);
    });
    it('🔴 созданный автором запроса — нельзя', () => {
      expect(canSecondApprove(maker, { id: 'b', role: 'admin', createdBy: maker }, 'merchant.freeze')).toBe(false);
    });
    it('🔴 создатель автора запроса — тоже нельзя', () => {
      expect(canSecondApprove(maker, { id: 'b', role: 'admin' }, 'merchant.freeze', 'b')).toBe(false);
    });
    it('авторство неизвестно (учётки до миграции) — правило не ужесточает', () => {
      expect(canSecondApprove(maker, { id: 'b', role: 'admin', createdBy: null }, 'merchant.freeze', null)).toBe(true);
    });
    it('без права роли — нельзя в любом случае', () => {
      expect(canSecondApprove(maker, { id: 'b', role: 'support' }, 'merchant.freeze')).toBe(false);
    });
  });

  it('finance НЕ может kyb.decide, но может payout.create', () => {
    expect(can('finance', 'kyb.decide')).toBe(false);
    expect(can('finance', 'payout.create')).toBe(true);
    expect(can('finance', 'tariff.change')).toBe(true);
  });

  it('risk_officer может заморозку и KYB, но не выплаты и не сотрудников', () => {
    expect(can('risk_officer', 'merchant.freeze')).toBe(true);
    expect(can('risk_officer', 'kyb.decide')).toBe(true);
    expect(can('risk_officer', 'payout.create')).toBe(false);
    expect(can('risk_officer', 'employee.manage')).toBe(false);
  });
});

describe('создание участников — права', () => {
  it('только admin создаёт сотрудников и агентов', () => {
    for (const r of ['risk_officer', 'finance', 'support'] as const) {
      expect(can(r, 'employee.create')).toBe(false);
      expect(can(r, 'agent.create')).toBe(false);
    }
    expect(can('admin', 'employee.create')).toBe(true);
    expect(can('admin', 'agent.create')).toBe(true);
  });

  it('мерчанта создают admin, risk_officer, support; finance — нет', () => {
    expect(can('admin', 'merchant.create')).toBe(true);
    expect(can('risk_officer', 'merchant.create')).toBe(true);
    expect(can('support', 'merchant.create')).toBe(true);
    expect(can('finance', 'merchant.create')).toBe(false);
  });
});

describe('canSecondApprove — self-confirm запрещён', () => {
  const maker = 'u1';
  it('автор не может подтвердить свой запрос', () => {
    expect(canSecondApprove(maker, { id: maker, role: 'admin' }, 'agent.create')).toBe(false);
  });
  it('другой admin — может; сотрудник без права — нет', () => {
    expect(canSecondApprove(maker, { id: 'u2', role: 'admin' }, 'agent.create')).toBe(true);
    expect(canSecondApprove(maker, { id: 'u2', role: 'support' }, 'agent.create')).toBe(false);
  });
  it('merchant.create подтверждает другой support', () => {
    expect(canSecondApprove(maker, { id: 'u2', role: 'support' }, 'merchant.create')).toBe(true);
  });
});

describe('requiresDualControl', () => {
  it('merchant.freeze требует второго сотрудника', () => {
    expect(requiresDualControl('merchant.freeze')).toBe(true);
  });

  it('полный набор dual-control действий', () => {
    const dual: Action[] = ['merchant.freeze', 'merchant.unfreeze', 'payout.create', 'refund.create'];
    for (const a of dual) {
      expect(requiresDualControl(a)).toBe(true);
    }
    expect(requiresDualControl('audit.read')).toBe(false);
    expect(requiresDualControl('kyb.decide')).toBe(false);
  });
});

/**
 * 🔴 Тупик первой пары администраторов. Роль `admin` требует второй подписи, а поставить её может
 * только другой `admin` — право `employee.create` есть лишь у этой роли. Пока админ один, завести
 * второго нельзя было вообще никак. Запрет при этом ничего не охранял: единственный админ и так
 * может всё. Очередь нужна там, где подтвердить РЕАЛЬНО есть кому.
 */
describe('создание администратора и вторая подпись', () => {
  it('🔴 подтверждать некому — очередь не нужна, иначе второго админа не завести', () => {
    expect(creationNeedsSecondApproval('admin', 0)).toBe(false);
  });

  it('есть кому подтвердить — двойной контроль возвращается сам', () => {
    expect(creationNeedsSecondApproval('admin', 1)).toBe(true);
    expect(creationNeedsSecondApproval('admin', 4)).toBe(true);
  });

  it('прочие роли второй подписи не требуют ни при каком числе админов', () => {
    for (const role of ['finance', 'risk_officer', 'support'] as const) {
      expect(creationNeedsSecondApproval(role, 0), role).toBe(false);
      expect(creationNeedsSecondApproval(role, 3), role).toBe(false);
    }
  });

  it('подтверждать создание сотрудника может только admin — это и есть причина тупика', () => {
    expect(rolesThatCanConfirmEmployeeCreation()).toEqual(['admin']);
  });
});

describe('rolesThatCan', () => {
  /**
   * Витрина очереди спрашивает «есть ли кому подтвердить» по ЛЮБОМУ создающему действию, не
   * только по сотруднику. Ответ обязан идти из матрицы: у заведения мерчанта подтверждающих
   * больше, чем у заведения админа, и захардкоженный список это бы проглядел.
   */
  it('отвечает по матрице, а не по списку в коде', () => {
    expect(rolesThatCan('employee.create')).toEqual(['admin']);
    expect(rolesThatCan('merchant.create').sort()).toEqual(['admin', 'risk_officer', 'support']);
    expect(rolesThatCanConfirmEmployeeCreation()).toEqual(rolesThatCan('employee.create'));
  });

  it('у права, которого ни у кого нет, подтверждающих ноль', () => {
    // Защита от тихого «подтвердит кто-нибудь»: пустой список обязан остаться пустым.
    const nobody = rolesThatCan('__nope__' as Action);
    expect(nobody).toEqual([]);
  });
});
