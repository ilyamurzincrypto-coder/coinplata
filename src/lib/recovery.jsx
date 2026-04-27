// src/lib/recovery.jsx
// RecoveryContext — поднимается на уровне AuthGate (App.jsx), читается
// в Root и SetPasswordPage. recoveryMode=true означает: текущая session
// создана через PASSWORD_RECOVERY (forgot password) или magic-link (invite),
// и юзер ОБЯЗАН установить пароль перед получением доступа к приложению.
//
// Вынесено отдельно от App.jsx чтобы избежать circular imports
// (App → SetPasswordPage → App).

import { createContext, useContext } from "react";

export const RecoveryContext = createContext({
  recoveryMode: false,
  forceSetPassword: false,
  clearRecovery: () => {},
});

export function useRecovery() {
  return useContext(RecoveryContext);
}
