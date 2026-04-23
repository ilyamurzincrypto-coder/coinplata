// src/lib/supabase.js
// Единственная точка создания Supabase-клиента. Работает в двух режимах:
//   1. Supabase configured: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY заданы.
//      Возвращает реальный клиент + isSupabaseConfigured = true.
//   2. Demo-mode: переменные не заданы. Возвращает null.
//      В этом режиме работает старый in-memory flow (AuthProvider с seed-user).
//
// Почему так: фронт уже живёт, бэкенд только планируется. До миграции
// на Supabase приложение должно продолжать работать в demo.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // для magic link callback
      },
    })
  : null;
