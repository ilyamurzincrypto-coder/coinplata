// src/store/data.js
// Моки данных: офисы, валюты, транзакции, контрагенты, пользователи.

export const OFFICES = [
  { id: "mark", name: "Mark Antalya", city: "Antalya" },
  { id: "terra", name: "Terra City", city: "Antalya" },
  { id: "ist", name: "Istanbul", city: "Istanbul" },
];

export const CURRENCIES = ["USDT", "USD", "EUR", "TRY", "GBP"];

export const TYPES = ["All", "IN", "OUT", "EXCHANGE"];

export const BALANCES_BY_OFFICE = {
  mark: {
    USD: { amount: 48250, change: 1.2 },
    USDT: { amount: 127430, change: -0.4 },
    EUR: { amount: 19800, change: 0.3 },
    TRY: { amount: 1842500, change: 2.8 },
    GBP: { amount: 8400, change: 0.1 },
  },
  terra: {
    USD: { amount: 22100, change: 0.6 },
    USDT: { amount: 64800, change: 1.1 },
    EUR: { amount: 8450, change: -0.2 },
    TRY: { amount: 920300, change: 1.4 },
    GBP: { amount: 3100, change: 0.0 },
  },
  ist: {
    USD: { amount: 91500, change: -0.3 },
    USDT: { amount: 204600, change: 2.1 },
    EUR: { amount: 37200, change: 0.8 },
    TRY: { amount: 3120000, change: 3.2 },
    GBP: { amount: 15800, change: 0.4 },
  },
};

// Транзакция теперь поддерживает массив outputs (multi-output).
// Для обратной совместимости остались plain-поля curOut/amtOut — они копируются из outputs[0].
export const SEED_TX = [
  {
    id: 1, time: "14:32", date: "Apr 20", officeId: "mark", type: "EXCHANGE",
    curIn: "USDT", amtIn: 5000,
    outputs: [{ currency: "TRY", amount: 194500, rate: 38.9 }],
    curOut: "TRY", amtOut: 194500, rate: 38.9,
    fee: 25, profit: 62.4,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "CryptoHouse", referral: false,
  },
  {
    id: 2, time: "14:05", date: "Apr 20", officeId: "mark", type: "EXCHANGE",
    curIn: "USD", amtIn: 1200,
    outputs: [{ currency: "TRY", amount: 46680, rate: 38.9 }],
    curOut: "TRY", amtOut: 46680, rate: 38.9,
    fee: 12, profit: 28.0,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "", referral: true,
  },
  {
    id: 3, time: "13:41", date: "Apr 20", officeId: "terra", type: "EXCHANGE",
    curIn: "EUR", amtIn: 800,
    outputs: [{ currency: "USDT", amount: 870, rate: 1.0875 }],
    curOut: "USDT", amtOut: 870, rate: 1.0875,
    fee: 10, profit: -3.5,
    manager: "S. Kaya", managerId: "u_sk",
    counterparty: "Murat Y.", referral: false,
  },
  {
    id: 4, time: "12:58", date: "Apr 20", officeId: "ist", type: "EXCHANGE",
    curIn: "USDT", amtIn: 10000,
    outputs: [{ currency: "USD", amount: 9985, rate: 0.9985 }],
    curOut: "USD", amtOut: 9985, rate: 0.9985,
    fee: 50, profit: 35.0,
    manager: "M. Demir", managerId: "u_md",
    counterparty: "Boris L.", referral: true,
  },
  {
    id: 5, time: "11:22", date: "Apr 20", officeId: "ist", type: "EXCHANGE",
    curIn: "TRY", amtIn: 120000,
    outputs: [{ currency: "USDT", amount: 3080, rate: 0.02567 }],
    curOut: "USDT", amtOut: 3080, rate: 0.02567,
    fee: 15, profit: 18.2,
    manager: "M. Demir", managerId: "u_md",
    counterparty: "", referral: false,
  },
  {
    id: 6, time: "10:48", date: "Apr 20", officeId: "mark", type: "IN",
    curIn: "USD", amtIn: 3500,
    outputs: [{ currency: "USD", amount: 3500, rate: 1 }],
    curOut: "USD", amtOut: 3500, rate: 1,
    fee: 0, profit: 0,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "Office deposit", referral: false,
  },
  {
    id: 7, time: "10:12", date: "Apr 20", officeId: "terra", type: "EXCHANGE",
    curIn: "USDT", amtIn: 2200,
    outputs: [{ currency: "TRY", amount: 85580, rate: 38.9 }],
    curOut: "TRY", amtOut: 85580, rate: 38.9,
    fee: 11, profit: 14.8,
    manager: "S. Kaya", managerId: "u_sk",
    counterparty: "CryptoHouse", referral: false,
  },
];

export const SEED_COUNTERPARTIES = [
  { id: "cp1", nickname: "CryptoHouse" },
  { id: "cp2", nickname: "Murat Y." },
  { id: "cp3", nickname: "Boris L." },
  { id: "cp4", nickname: "Office deposit" },
];

export const SEED_USERS = [
  { id: "u_ay", name: "A. Yilmaz", initials: "AY", role: "manager" },
  { id: "u_sk", name: "S. Kaya", initials: "SK", role: "manager" },
  { id: "u_md", name: "M. Demir", initials: "MD", role: "manager" },
  { id: "u_adm", name: "E. Kara", initials: "EK", role: "admin" },
];

export const officeName = (id) => OFFICES.find((o) => o.id === id)?.name || id;
