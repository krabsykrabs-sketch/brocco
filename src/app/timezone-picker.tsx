"use client";

import { useState, useEffect } from "react";
import { useT } from "@/app/features-provider";

/**
 * IANA timezone picker — a select instead of a free-text input, because one
 * typo ("Europe/berlin") silently breaks every "today" computation for the
 * user. Falls back to a text input on browsers without supportedValuesOf.
 */
export default function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const t = useT();
  const [zones, setZones] = useState<string[] | null>(null);
  const [deviceTz, setDeviceTz] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supported = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
      setZones(supported && supported.length > 0 ? supported : null);
    } catch {
      setZones(null);
    }
    try {
      setDeviceTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch { /* leave null */ }
  }, []);

  const inputCls = "field";

  return (
    <div className="space-y-1">
      {zones ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {/* Keep a stored-but-unknown value selectable rather than silently jumping */}
          {value && !zones.includes(value) && <option value={value}>{value}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("settings.timezonePlaceholder")}
          className={inputCls}
        />
      )}
      {deviceTz && deviceTz !== value && (
        <button
          type="button"
          onClick={() => onChange(deviceTz)}
          className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
        >
          {t("settings.useDeviceTimezone").replace("{tz}", deviceTz)}
        </button>
      )}
    </div>
  );
}
