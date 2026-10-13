import { describe, expect, it } from 'vitest';
import { checkDbEnv, normalizeEndpoint } from './db-endpoint-guard';

const PROD = 'ep-wispy-river';
const PREVIEW_URL = 'postgresql://u:p@ep-nameless-heart-ahoz-pooler.c-3.us-east-1.aws.neon.tech/neondb';
const PROD_URL = 'postgresql://u:p@ep-wispy-river-ahxwytw8-pooler.c-3.us-east-1.aws.neon.tech/neondb';

describe('гард endpoint базы', () => {
  it('пулер и не-пулер — один и тот же endpoint, не повод для тревоги', () => {
    expect(normalizeEndpoint('ep-wispy-river-ahxwytw8-pooler.c-3.aws.neon.tech')).toBe(PROD);
    expect(normalizeEndpoint('ep-wispy-river-ahxwytw8.c-3.aws.neon.tech')).toBe(PROD);
  });

  it('🔴 СЕГОДНЯШНЯЯ МИНА: превьюшный DATABASE_URL и прод в PGHOST — отказ с именем переменной', () => {
    const v = checkDbEnv({ DATABASE_URL: PREVIEW_URL, PGHOST: 'ep-wispy-river-ahxwytw8-pooler.c-3.aws.neon.tech' }, PROD);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('conflict');
    expect(v.message).toContain('PGHOST');
  });

  it('🔴 ИНЦИДЕНТ Д2: файл назван preview, а DATABASE_URL смотрит на прод — отказ', () => {
    // Здесь ВСЁ согласовано: гард «по согласованности» такое пропустил бы, и именно так и вышло.
    const v = checkDbEnv({ DATABASE_URL: PROD_URL }, PROD);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('production');
  });

  it('осознанный шаг мерж-чеклиста разрешён явным флагом', () => {
    expect(checkDbEnv({ DATABASE_URL: PROD_URL, ALLOW_PROD_DB: '1' }, PROD).ok).toBe(true);
  });

  it('🔴 на Vercel гард молчит ЦЕЛИКОМ — включая несогласованные PG*', () => {
    // Превью-рантайм законно видит прод в PG*: Neon кладёт их на уровень проекта. Первая версия
    // проверяла согласованность и на Vercel — страница оплаты превью отдавала 500 вместо 404.
    expect(checkDbEnv({ DATABASE_URL: PROD_URL, VERCEL_REGION: 'iad1' }, PROD).ok).toBe(true);
    const preview = { DATABASE_URL: PREVIEW_URL, PGHOST: 'ep-wispy-river-x-pooler.c-3.aws.neon.tech', VERCEL_REGION: 'iad1' };
    expect(checkDbEnv(preview, PROD).ok).toBe(true);
    // ...а та же картина ЛОКАЛЬНО по-прежнему останавливается.
    expect(checkDbEnv({ ...preview, VERCEL_REGION: undefined }, PROD).ok).toBe(false);
  });

  it('🔴 VERCEL=1 из скачанного env-файла гард НЕ отключает', () => {
    // `vercel env pull` пишет VERCEL="1" в файл. Первая версия принимала это за «мы на Vercel»
    // и молча пропускала локальный прогон по боевой базе — то есть отключалась именно там,
    // где была нужна. Проверено живьём: три прогона ушли на прод, гард промолчал.
    const v = checkDbEnv({ DATABASE_URL: PROD_URL, VERCEL: '1', VERCEL_ENV: 'production' }, PROD);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('production');
  });

  it('чистое превью проходит', () => {
    const v = checkDbEnv({ DATABASE_URL: PREVIEW_URL, DATABASE_URL_UNPOOLED: PREVIEW_URL.replace('-pooler', '') }, PROD);
    expect(v.ok).toBe(true);
    expect(v.endpoint).toBe('ep-nameless-heart');
  });

  it('посторонние переменные гард не трогает', () => {
    const v = checkDbEnv({ DATABASE_URL: PREVIEW_URL, NEXTAUTH_URL: 'https://ep-wispy-river.example' }, PROD);
    expect(v.ok).toBe(true);
  });

  it('без DATABASE_URL молчит — это не его забота', () => {
    expect(checkDbEnv({}, PROD).ok).toBe(true);
  });
});

describe('гард не выдумывает адреса и не печатает секреты', () => {
  it('🔴 пароль и имя пользователя — НЕ адреса: ни тревоги, ни значения в тексте', () => {
    // Первая версия гарда приняла POSTGRES_PASSWORD за хост, подняла ложную тревогу
    // и вывела значение пароля в сообщение об ошибке.
    const v = checkDbEnv(
      { DATABASE_URL: PROD_URL, ALLOW_PROD_DB: '1', POSTGRES_PASSWORD: 'npg_secret_value', POSTGRES_USER: 'neondb_owner', PGDATABASE: 'neondb' },
      PROD,
    );
    expect(v.ok).toBe(true);
    expect(JSON.stringify(v)).not.toContain('npg_secret_value');
  });

  it('значение, не похожее на адрес, endpoint\'ом не считается', () => {
    expect(normalizeEndpoint('neondb_owner')).toBeNull();
    expect(normalizeEndpoint('neondb')).toBeNull();
    expect(normalizeEndpoint('localhost')).toBe('localhost');
  });

  it('🔴 но НАСТОЯЩИЙ чужой хост в PGHOST по-прежнему ловится', () => {
    const v = checkDbEnv({ DATABASE_URL: PREVIEW_URL, PGHOST: 'ep-wispy-river-ahxwytw8-pooler.c-3.aws.neon.tech' }, PROD);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('PGHOST');
  });
});

describe('сборка на Vercel не должна падать из-за гарда', () => {
  it('🔴 явный признак «мы внутри Vercel» снимает запрет на боевой endpoint', () => {
    // При СБОРКЕ на Vercel региона ещё нет, а DATABASE_URL уже боевой. Без этого флага гард
    // уронил бы прод-деплой — защита от промаха не имеет права ломать выкатку.
    expect(checkDbEnv({ DATABASE_URL: PROD_URL }, PROD, { onVercel: true }).ok).toBe(true);
    expect(checkDbEnv({ DATABASE_URL: PROD_URL }, PROD, { onVercel: false }).ok).toBe(false);
  });
});
