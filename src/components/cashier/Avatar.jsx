// src/components/cashier/Avatar.jsx
// Manager avatar — круглый 24×24, fallback на initials в brand color.
// Если в будущем добавится users.avatar_url — рендерим <img>.

import React from "react";

export default function Avatar({ initials, name, size = 24, className = "" }) {
  return (
    <div
      title={name}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full flex items-center justify-center text-tiny font-bold uppercase tracking-tight bg-surface-sunk text-[var(--brand-primary)] ${className}`}
      aria-label={name}
    >
      {initials || "?"}
    </div>
  );
}
