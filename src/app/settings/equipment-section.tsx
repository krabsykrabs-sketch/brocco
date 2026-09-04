"use client";

import { useEffect, useState } from "react";
import { COMMON_EQUIPMENT, equipmentLabel } from "@/lib/equipment";
import { useT } from "@/app/features-provider";

/**
 * Kit the athlete owns, so Brocco prescribes around it.
 *
 * Deliberately the same shape as the kitchen's "always in stock" list — chips
 * you add and remove, free text rather than a fixed menu — because it is the
 * same problem: telling the coach what you have so it stops guessing. The
 * suggestions are a shortcut, not a whitelist.
 */
export function EquipmentSection() {
  const t = useT();
  const [equipment, setEquipment] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile/equipment")
      .then((r) => (r.ok ? r.json() : { equipment: [] }))
      .then((d) => setEquipment(d.equipment || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(next: string[]) {
    const prev = equipment;
    setEquipment(next); // optimistic — the list is the control
    setError(null);
    try {
      const res = await fetch("/api/profile/equipment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment: next }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setEquipment(d.equipment || next);
    } catch {
      setEquipment(prev);
      setError(t("equipment.saveFailed"));
    }
  }

  function addFromInput() {
    // Comma-separated entry: "bands, 16kg kettlebell, balance board"
    const items = input.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setInput("");
    save([...equipment, ...items]);
  }

  const has = (item: string) => equipment.some((e) => e.toLowerCase() === item.toLowerCase());
  const suggestions = COMMON_EQUIPMENT.filter((s) => !has(s));

  return (
    <section className="sticker px-4 py-3">
      <p className="text-sm font-bold text-ink">🏋️ {t("equipment.title")}</p>
      <p className="text-[11px] text-moss font-semibold mt-0.5 mb-2">
        {t("equipment.blurb")}
      </p>

      {loaded && equipment.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {equipment.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 bg-ghost border-2 border-ink rounded-full pl-2.5 pr-1 py-0.5 text-xs text-ink font-bold"
            >
              {equipmentLabel(item, t)}
              <button
                onClick={() => save(equipment.filter((x) => x !== item))}
                aria-label={t("equipment.remove").replace("{item}", item)}
                className="w-4 h-4 flex items-center justify-center rounded-full text-moss hover:text-clay"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addFromInput(); }}
          placeholder={t("equipment.placeholder")}
          className="field flex-1"
          aria-label={t("equipment.addAria")}
        />
        <button
          onClick={addFromInput}
          disabled={!input.trim()}
          className="btn-quiet px-3 text-xs disabled:opacity-40"
        >
          {t("equipment.add")}
        </button>
      </div>

      {error && <p className="text-[11px] text-clay font-bold mt-1.5">{error}</p>}

      {loaded && suggestions.length > 0 && (
        <div className="mt-2.5">
          <p className="label-xs mb-1.5">{t("equipment.commonKit")}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 8).map((s) => (
              <button
                key={s}
                onClick={() => save([...equipment, s])}
                className="bg-card border-2 border-shade rounded-full px-2.5 py-0.5 text-xs text-moss font-bold hover:border-ink hover:text-ink"
              >
                + {equipmentLabel(s, t)}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
