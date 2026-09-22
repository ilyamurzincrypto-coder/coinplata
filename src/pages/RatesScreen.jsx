// src/pages/RatesScreen.jsx
// Раздел «Курсы» — обычная страница топбара, как Счета/Казначейство. Раньше
// редактор выезжал drawer'ом поверх кассы с анимацией; теперь просто страница.
// Внутри — те же редакторы без изменений.

import React from "react";
import RatesPage from "./RatesPage.jsx";
import RatesEditorV2 from "./RatesEditorV2.jsx";
import { isRatesV2Enabled } from "../lib/ratesV2.js";
import { useAuth } from "../store/auth.jsx";

export default function RatesScreen() {
  // Флаг rates_v2_ui персональный (users.preferences). Выключен — старый редактор.
  const { currentUser } = useAuth();
  return isRatesV2Enabled(currentUser) ? <RatesEditorV2 /> : <RatesPage />;
}
