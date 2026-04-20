// src/i18n/translations.js
// Простая i18n-реализация без библиотек.
// Использование: const { t, lang, setLang } = useTranslation();

import { createContext, useContext, useState } from "react";

const DICT = {
  en: {
    // Nav
    nav_cashier: "Cashier",
    nav_capital: "Capital",
    nav_referrals: "Referrals",
    nav_settings: "Settings",

    // Header
    language: "Language",
    manager: "Manager",
    admin: "Admin",

    // Rates bar
    rates: "Rates",
    edit_rates: "Edit rates",
    rate_updated: "updated",

    // Balances
    balances: "Balances",
    selected_office: "Selected office",
    all_offices: "All offices",
    updated_ago: "updated 2 min ago",

    // Exchange form
    new_exchange: "New exchange",
    edit_exchange: "Edit exchange",
    you_received: "You received",
    you_gave: "You gave",
    commission: "Commission",
    from_client: "from client",
    to_client: "to client",
    available: "Available",
    rate: "Rate",
    manual_rate: "Manual rate",
    auto_rate: "Auto rate",
    min_fee_notice: "Min $10 fee applies",
    comment_placeholder: "Comment (optional)…",
    referral_client: "Referral client",
    add_output: "Add output",
    remove: "Remove",
    counterparty: "Counterparty",
    select_or_type: "Select or type nickname…",

    create_transaction: "Create transaction",
    save_changes: "Save changes",
    cancel: "Cancel",
    enter_amount_received: "Enter amount received",
    enter_exchange_rate: "Enter exchange rate",
    currencies_must_differ: "Currencies must differ",
    complete_the_form: "Complete the form",

    // Table
    transactions: "Transactions",
    search_placeholder: "Search manager, amount…",
    filters: "Filters",
    clear: "Clear",
    time: "Time",
    type: "Type",
    in: "In",
    out: "Out",
    fee: "Fee",
    profit: "Profit",
    actions: "Actions",
    no_match: "No transactions match your filters",
    clear_filters: "Clear filters",
    showing: "Showing",
    total_fees: "Total fees",
    net_profit: "Net profit",
    edit: "Edit",
    not_your_tx: "Only the creator or an admin can edit this",

    // Filters
    all: "All",
    today: "Today",
    yesterday: "Yesterday",
    last_7: "Last 7 days",
    this_month: "This month",
    all_time: "All time",

    // Settings
    settings_title: "Settings",
    users_and_roles: "Users & roles",
    add_user: "Add user",
    role_admin: "Admin",
    role_manager: "Manager",
    rates_management: "Rates",
    system_settings: "System",
    min_fee_label: "Minimum commission (USD)",
    referral_pct_label: "Referral rate (%)",
    save: "Save",
    logged_in_as: "Logged in as",
    switch_role: "Switch role (demo)",

    // Referrals
    referrals_title: "Referrals",
    ref_manager: "Manager",
    ref_deals: "Deals",
    ref_volume: "Volume (USD)",
    ref_income: "Income",
    ref_bonus: "Bonus",

    // Capital
    capital_title: "Capital",
    turnover_by_office: "Turnover by office",
    stats_by_manager: "Stats by manager",
    date_range: "Date range",
  },

  ru: {
    nav_cashier: "Касса",
    nav_capital: "Капитал",
    nav_referrals: "Рефералы",
    nav_settings: "Настройки",

    language: "Язык",
    manager: "Менеджер",
    admin: "Админ",

    rates: "Курсы",
    edit_rates: "Редактировать курсы",
    rate_updated: "обновлено",

    balances: "Балансы",
    selected_office: "Выбранный офис",
    all_offices: "Все офисы",
    updated_ago: "обновлено 2 мин назад",

    new_exchange: "Новая сделка",
    edit_exchange: "Редактировать сделку",
    you_received: "Получили",
    you_gave: "Выдали",
    commission: "Комиссия",
    from_client: "от клиента",
    to_client: "клиенту",
    available: "Доступно",
    rate: "Курс",
    manual_rate: "Ручной курс",
    auto_rate: "Авто курс",
    min_fee_notice: "Действует минимум $10",
    comment_placeholder: "Комментарий (опционально)…",
    referral_client: "Реферальный клиент",
    add_output: "Добавить выдачу",
    remove: "Удалить",
    counterparty: "Контрагент",
    select_or_type: "Выберите или введите ник…",

    create_transaction: "Создать сделку",
    save_changes: "Сохранить",
    cancel: "Отмена",
    enter_amount_received: "Введите сумму",
    enter_exchange_rate: "Введите курс",
    currencies_must_differ: "Валюты должны отличаться",
    complete_the_form: "Заполните форму",

    transactions: "Транзакции",
    search_placeholder: "Поиск по менеджеру, сумме…",
    filters: "Фильтры",
    clear: "Очистить",
    time: "Время",
    type: "Тип",
    in: "Вход",
    out: "Выход",
    fee: "Комиссия",
    profit: "Прибыль",
    actions: "Действия",
    no_match: "Нет транзакций по фильтрам",
    clear_filters: "Сбросить фильтры",
    showing: "Показано",
    total_fees: "Всего комиссий",
    net_profit: "Чистая прибыль",
    edit: "Редактировать",
    not_your_tx: "Редактировать может только автор или админ",

    all: "Все",
    today: "Сегодня",
    yesterday: "Вчера",
    last_7: "Последние 7 дней",
    this_month: "Этот месяц",
    all_time: "За всё время",

    settings_title: "Настройки",
    users_and_roles: "Пользователи и роли",
    add_user: "Добавить",
    role_admin: "Админ",
    role_manager: "Менеджер",
    rates_management: "Курсы",
    system_settings: "Система",
    min_fee_label: "Минимальная комиссия (USD)",
    referral_pct_label: "Реферальный процент (%)",
    save: "Сохранить",
    logged_in_as: "Вы вошли как",
    switch_role: "Сменить роль (демо)",

    referrals_title: "Рефералы",
    ref_manager: "Менеджер",
    ref_deals: "Сделки",
    ref_volume: "Оборот (USD)",
    ref_income: "Доход",
    ref_bonus: "Бонус",

    capital_title: "Капитал",
    turnover_by_office: "Оборот по офисам",
    stats_by_manager: "Статистика по менеджерам",
    date_range: "Период",
  },

  tr: {
    nav_cashier: "Kasa",
    nav_capital: "Sermaye",
    nav_referrals: "Referanslar",
    nav_settings: "Ayarlar",

    language: "Dil",
    manager: "Yönetici",
    admin: "Yönetici (Admin)",

    rates: "Kurlar",
    edit_rates: "Kurları düzenle",
    rate_updated: "güncellendi",

    balances: "Bakiyeler",
    selected_office: "Seçili ofis",
    all_offices: "Tüm ofisler",
    updated_ago: "2 dk önce güncellendi",

    new_exchange: "Yeni işlem",
    edit_exchange: "İşlemi düzenle",
    you_received: "Alındı",
    you_gave: "Verildi",
    commission: "Komisyon",
    from_client: "müşteriden",
    to_client: "müşteriye",
    available: "Mevcut",
    rate: "Kur",
    manual_rate: "Manuel kur",
    auto_rate: "Otomatik kur",
    min_fee_notice: "Minimum $10 komisyon uygulanır",
    comment_placeholder: "Yorum (opsiyonel)…",
    referral_client: "Referanslı müşteri",
    add_output: "Çıkış ekle",
    remove: "Sil",
    counterparty: "Karşı taraf",
    select_or_type: "Seç veya takma ad yaz…",

    create_transaction: "İşlemi oluştur",
    save_changes: "Değişiklikleri kaydet",
    cancel: "İptal",
    enter_amount_received: "Alınan tutarı girin",
    enter_exchange_rate: "Kuru girin",
    currencies_must_differ: "Para birimleri farklı olmalı",
    complete_the_form: "Formu doldurun",

    transactions: "İşlemler",
    search_placeholder: "Yönetici, tutar ara…",
    filters: "Filtreler",
    clear: "Temizle",
    time: "Saat",
    type: "Tür",
    in: "Giriş",
    out: "Çıkış",
    fee: "Komisyon",
    profit: "Kâr",
    actions: "Eylemler",
    no_match: "Filtrelere uygun işlem yok",
    clear_filters: "Filtreleri temizle",
    showing: "Gösterilen",
    total_fees: "Toplam komisyon",
    net_profit: "Net kâr",
    edit: "Düzenle",
    not_your_tx: "Yalnızca sahibi veya admin düzenleyebilir",

    all: "Tümü",
    today: "Bugün",
    yesterday: "Dün",
    last_7: "Son 7 gün",
    this_month: "Bu ay",
    all_time: "Tüm zamanlar",

    settings_title: "Ayarlar",
    users_and_roles: "Kullanıcılar & roller",
    add_user: "Kullanıcı ekle",
    role_admin: "Admin",
    role_manager: "Yönetici",
    rates_management: "Kurlar",
    system_settings: "Sistem",
    min_fee_label: "Minimum komisyon (USD)",
    referral_pct_label: "Referans oranı (%)",
    save: "Kaydet",
    logged_in_as: "Giriş yapan",
    switch_role: "Rolü değiştir (demo)",

    referrals_title: "Referanslar",
    ref_manager: "Yönetici",
    ref_deals: "İşlemler",
    ref_volume: "Hacim (USD)",
    ref_income: "Gelir",
    ref_bonus: "Bonus",

    capital_title: "Sermaye",
    turnover_by_office: "Ofis bazında ciro",
    stats_by_manager: "Yönetici istatistikleri",
    date_range: "Tarih aralığı",
  },
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState("EN");
  const dict = DICT[lang.toLowerCase()] || DICT.en;
  const t = (key) => dict[key] ?? key;
  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used inside I18nProvider");
  return ctx;
}
