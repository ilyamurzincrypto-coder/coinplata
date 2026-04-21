// src/pages/SettingsPage.jsx
// Тонкая обёртка над новым Supabase-style layout.
// Ранее этот файл содержал всю логику настроек — теперь она разбита на табы в pages/settings/*.

import React from "react";
import SettingsLayout from "./settings/SettingsLayout.jsx";

export default function SettingsPage() {
  return <SettingsLayout />;
}
