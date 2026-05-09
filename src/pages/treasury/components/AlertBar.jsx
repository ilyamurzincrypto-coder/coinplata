// src/pages/treasury/components/AlertBar.jsx
import React from "react";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

const SEVERITY_STYLE = {
  error:   { wrap: "bg-rose-50 border-rose-200 text-rose-900",   icon: AlertCircle,   iconCls: "text-rose-600"   },
  warning: { wrap: "bg-amber-50 border-amber-200 text-amber-900",icon: AlertTriangle, iconCls: "text-amber-600"  },
  info:    { wrap: "bg-sky-50 border-sky-200 text-sky-900",      icon: Info,          iconCls: "text-sky-600"    },
};

const ALERT_KEY = {
  overdue_obligations: "tr_alert_overdue_obligations",
  negative_balance:    "tr_alert_negative_balance",
  stuck_pending:       "tr_alert_stuck_pending",
  stale_rates:         "tr_alert_stale_rates",
};

export default function AlertBar({ alerts }) {
  const { t } = useTranslation();
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a) => {
        const sev = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.info;
        const Icon = sev.icon;
        const tplKey = ALERT_KEY[a.id];
        const msg = tplKey
          ? t(tplKey).replace("{n}", String(a.count ?? ""))
          : a.id;
        return (
          <div
            key={a.id}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border text-[12.5px] font-medium ${sev.wrap}`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${sev.iconCls}`} />
            <span>{msg}</span>
          </div>
        );
      })}
    </div>
  );
}
