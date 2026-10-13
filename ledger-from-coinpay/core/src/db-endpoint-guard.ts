/**
 * Гард соединения с базой: не дать локальному прогону молча уйти на БОЕВУЮ базу.
 *
 * Ловит ДВА разных промаха, оба уже случившихся:
 *
 *  1. **Несогласованные переменные** (сегодняшняя мина). `vercel env pull --environment=preview`
 *     кладёт `PG*`/`POSTGRES_*` с ПРОД-endpoint'ом рядом с превьюшным `DATABASE_URL`, потому что
 *     Neon-интеграция держит их на уровне проекта. Скрипт, читающий `PGHOST`, уходил на прод.
 *
 *  2. **Согласованный, но боевой endpoint** (инцидент Д2, правило БД №12). Файл назывался
 *     `.env.preview.local`, а `DATABASE_URL` внутри смотрел на прод — «прогон на превью» шёл по
 *     боевой базе, и это выяснилось постфактум. Гард по одной лишь согласованности такое пропустит:
 *     там всё было согласовано. Поэтому боевой endpoint локально требует ЯВНОГО `ALLOW_PROD_DB=1`.
 *
 * Гард молчит на Vercel: там превью-рантайм законно видит прод-значения в `PG*`, и падать нельзя.
 * Опасность — локальная машина и CI-скрипты, где имя файла ничего не гарантирует.
 *
 * 🔴 «Мы на Vercel» определяется по `VERCEL_REGION`, а НЕ по `VERCEL`. Причина: `vercel env pull`
 * записывает `VERCEL="1"` прямо в скачанный файл, и локальный прогон с прод-переменными выглядел
 * для гарда «выполнением на Vercel» — то есть гард отключал сам себя в единственном опасном случае.
 * `VERCEL_REGION` присваивается рантаймом функции и в скачиваемые файлы не попадает.
 */

export interface DbEnvVerdict {
  ok: boolean;
  /** Endpoint, на который реально смотрит DATABASE_URL (нормализованный ярлык, напр. `ep-wispy-river`). */
  endpoint: string | null;
  reason?: 'conflict' | 'production';
  message?: string;
}

/**
 * Переменные, НЕСУЩИЕ АДРЕС: только они могут увести скрипт в другую базу.
 * Список намеренно узкий. Первая версия брала все `POSTGRES_*`/`PG*` — и приняла `POSTGRES_PASSWORD`
 * за хост: гард ругался не по делу И ПЕЧАТАЛ ЗНАЧЕНИЕ ПАРОЛЯ в тексте ошибки. Пароль — не адрес,
 * ему здесь не место ни при какой логике.
 */
const HOST_VAR = /^(DATABASE_URL(_UNPOOLED)?|POSTGRES_(URL|PRISMA_URL|URL_NON_POOLING|URL_NO_SSL|HOST)|PGHOST(_UNPOOLED)?)$/;

/**
 * Ярлык endpoint'а из URL или голого хоста. `ep-lucky-resonance-123-pooler.c-3.aws…` → `ep-lucky-resonance`.
 * Пулер и суффикс проекта отбрасываются: это тот же самый физический endpoint.
 */
export function normalizeEndpoint(value: string): string | null {
  const m = /(ep-[a-z]+-[a-z]+)/i.exec(value);
  if (m) return m[1]!.toLowerCase();
  // Не-Neon (локальный постгрес и т.п.) — опознаём по хосту, но ТОЛЬКО если это правда похоже на
  // адрес: есть схема, точка в имени или это localhost. Иначе вернём null и промолчим — лучше не
  // проверить лишнюю переменную, чем принять за адрес чужое значение.
  const raw = value.trim();
  const host = /^(?:[a-z]+:\/\/)?(?:[^@/]*@)?([^:/?\s]+)/i.exec(raw);
  const h = host?.[1]?.toLowerCase();
  if (!h) return null;
  if (/^localhost$/.test(h) || h.includes('.')) return h;
  return null;
}

/**
 * Проверяет окружение перед соединением.
 * @param env переменные окружения
 * @param prodEndpoint ярлык БОЕВОГО endpoint'а — прогон по нему локально требует ALLOW_PROD_DB=1
 */
export function checkDbEnv(
  env: Record<string, string | undefined>,
  prodEndpoint: string,
  opts: {
    /**
     * Выполняемся ли мы ВНУТРИ Vercel. По умолчанию — по `VERCEL_REGION` (рантайм функции).
     * Вызывающий обязан передать `true` и для СБОРКИ на Vercel: там региона ещё нет, а
     * `DATABASE_URL` уже боевой — гард иначе уронил бы прод-деплой на ровном месте.
     */
    onVercel?: boolean;
  } = {},
): DbEnvVerdict {
  const primaryRaw = env.DATABASE_URL;
  if (!primaryRaw) return { ok: true, endpoint: null };
  const endpoint = normalizeEndpoint(primaryRaw);

  // ВНУТРИ Vercel гард молчит целиком. Там превью-рантайм ЗАКОННО видит прод-значения в PG*
  // (Neon-интеграция кладёт их на уровень проекта, убрать оттуда нельзя), а само приложение
  // ходит только через DATABASE_URL. Проверено живьём: без этого выхода гард отдавал 500 на
  // странице оплаты превью там, где прод отдаёт 404. Защита от промаха не имеет права ломать
  // работающее приложение — её адресат исключительно локальные прогоны и скрипты.
  const onVercel = opts.onVercel ?? Boolean(env.VERCEL_REGION);
  if (onVercel) return { ok: true, endpoint };

  // (1) Кто-то из соседей смотрит в другую сторону — значит скрипт может взять не тот адрес.
  const strays: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value || name === 'DATABASE_URL' || !HOST_VAR.test(name)) continue;
    const e = normalizeEndpoint(value);
    if (e && endpoint && e !== endpoint) strays.push(`${name}→${e}`);
  }
  if (strays.length > 0) {
    return {
      ok: false, endpoint, reason: 'conflict',
      message:
        `DATABASE_URL смотрит на ${endpoint}, а рядом лежат переменные на другой endpoint: ${strays.join(', ')}. ` +
        'Скрипт, читающий их вместо DATABASE_URL, уйдёт не в ту базу. Убери лишние переменные из env-файла.',
    };
  }

  // (2) Боевая база локально — только по явному разрешению, а не по имени файла.
  if (endpoint === prodEndpoint && env.ALLOW_PROD_DB !== '1') {
    return {
      ok: false, endpoint, reason: 'production',
      message:
        `DATABASE_URL смотрит на БОЕВУЮ базу (${endpoint}). Имя env-файла ничего не гарантирует — ` +
        'ровно так прогон Д2 ушёл на прод. Если это осознанный шаг мерж-чеклиста, запусти с ALLOW_PROD_DB=1.',
    };
  }

  return { ok: true, endpoint };
}
