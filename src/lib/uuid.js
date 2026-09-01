// src/lib/uuid.js
// Одна проверка UUID на приложение. Раньше та же регулярка жила копиями в
// supabaseWrite.js и cashierDeals.js.
//
// ЗАЧЕМ ЭТО ВООБЩЕ ВАЖНО: id офиса по умолчанию был сидовым "mark", и
// PostgREST на `office_id=eq.mark` отвечал 400 «invalid input syntax for type
// uuid». Ошибка глоталась в console.warn — заявки и закрытия кассы молча
// показывали пусто. Проверка нужна ДО запроса, а не после.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Страж для фильтров по офису. Бросает читаемую ошибку вместо того, чтобы
 * отправить заведомо битый id в базу и получить 400 без объяснений.
 * null/undefined пропускаются: «без фильтра» — законное состояние.
 */
export function assertOfficeId(officeId, where) {
  if (officeId == null || officeId === "") return null;
  if (!isUuid(officeId)) {
    throw new Error(
      `${where}: id офиса «${officeId}» не является UUID — запрос не отправлен. ` +
        "Похоже, выбран офис из демо-данных или сохранённый выбор устарел."
    );
  }
  return officeId;
}
