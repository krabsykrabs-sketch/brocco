"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { InstallInstructions } from "@/app/pwa-banner";
import { DesktopNavLinks } from "@/app/nav";
import { FEATURES_CHANGED_EVENT, useT, useLang, useFmt, type Fmt } from "@/app/features-provider";
import { LANGUAGES, LANGUAGE_NAMES, detectLang, type Lang } from "@/lib/i18n";
import { ALL_FEATURES, type Features } from "@/lib/features";
import { EquipmentSection } from "./equipment-section";
import { Suspense } from "react";

type T = ReturnType<typeof useT>;

/** "" is the running default (stored as null). Anything else Brocco saved from chat shows as its own option. */
const PRIMARY_SPORTS = ["", "climbing", "cycling", "swimming", "triathlon", "hyrox"];

interface ProfileData {
  name: string;
  email: string;
  stravaConnected: boolean;
  stravaAthleteId: string | null;
  stravaLastSyncAt: string | null;
  stravaLastSyncError: string | null;
  stravaNeedsReconnect: boolean;
  intervalsConnected: boolean;
  intervalsAthleteId: string | null;
  timezone: string;
  language: string | null;
  primarySport: string | null;
  goalRace: string | null;
  goalTime: string | null;
  goalRaceDate: string | null;
  hrMaxBpm: number | null;
}

interface SyncData {
  created?: number; updated?: number; deleted?: number;
  hasActivePlan?: boolean; windowWorkouts?: number; desiredCount?: number;
  skippedType?: number; skippedNoTarget?: number; onCalendar?: number;
}

/**
 * Turn a sync result into a message that explains a "nothing changed"
 * outcome — the common confusion is that "0 new" can mean either
 * "already up to date" or "nothing to push", which need opposite fixes.
 */
function describeSync(d: SyncData, t: T, fmt: Fmt): string {
  const changed = (d.created || 0) + (d.updated || 0) + (d.deleted || 0);
  if (changed > 0) {
    return t("settings.syncChanged")
      .replace("{created}", String(d.created || 0))
      .replace("{updated}", String(d.updated || 0))
      .replace("{deleted}", String(d.deleted || 0));
  }
  // Nothing changed — say why.
  if (d.hasActivePlan === false) {
    return t("settings.syncNoPlan");
  }
  const desired = d.desiredCount || 0;
  if (desired > 0) {
    return fmt.plural(desired, t("settings.syncUpToDateOne"), t("settings.syncUpToDateMany")).replace("{n}", String(desired));
  }
  const inWindow = d.windowWorkouts || 0;
  if (inWindow === 0) {
    return t("settings.syncNothingScheduled");
  }
  // Workouts exist in the window but none were syncable.
  const bits: string[] = [];
  if (d.skippedType) bits.push(t("settings.syncSkippedType").replace("{n}", String(d.skippedType)));
  if (d.skippedNoTarget) bits.push(t("settings.syncSkippedNoTarget").replace("{n}", String(d.skippedNoTarget)));
  const why = bits.length ? ` — ${bits.join(", ")}` : "";
  return fmt.plural(inWindow, t("settings.syncNoneSyncableOne"), t("settings.syncNoneSyncableMany"))
    .replace("{n}", String(inWindow))
    .replace("{why}", why);
}

/**
 * Renders **bold** and `code` spans from a dictionary string, so the setup
 * steps translate as whole sentences instead of word-order-dependent fragments.
 */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : p.startsWith("`") ? (
          <code key={i} className="text-ink font-bold">{p.slice(1, -1)}</code>
        ) : (
          p
        )
      )}
    </>
  );
}

/**
 * Watch sync via intervals.icu — planned workouts are pushed to the user's
 * intervals.icu calendar, which forwards them to COROS / Garmin / Wahoo /
 * Polar / Suunto with full interval structure.
 */
function WatchSyncSection({ profile }: { profile: ProfileData }) {
  const t = useT();
  const fmt = useFmt();
  const [connected, setConnected] = useState(profile.intervalsConnected);
  const [connectedId, setConnectedId] = useState(profile.intervalsAthleteId);
  const [athleteId, setAthleteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function handleConnect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/intervals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || t("settings.connectionFailed"));
        return;
      }
      const s = data.initialSync;
      setMessage(
        `${t("settings.connected")}${data.athleteName ? ` ${t("settings.connectedAs").replace("{name}", data.athleteName)}` : ""}.` +
          (s?.synced ? ` ${describeSync(s, t, fmt)}` : "")
      );
      setConnected(true);
      setConnectedId(athleteId.trim());
      setAthleteId("");
      setApiKey("");
    } catch {
      setMessage(t("settings.connectionFailedRetry"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/intervals/sync", { method: "POST" });
      const data = await res.json();
      setMessage(res.ok ? describeSync(data, t, fmt) : data.error || t("settings.syncFailed"));
    } catch {
      setMessage(t("settings.syncFailedRetry"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setMessage(null);
    await fetch("/api/intervals", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    setConnected(false);
    setConnectedId(null);
  }

  const inputCls = "field";

  return (
    <section>
      <h2 className="text-lg font-extrabold mb-1">{t("settings.watchSync")}</h2>
      <p className="text-xs text-moss mb-3">
        {t("settings.watchSyncBlurb")}
      </p>
      <div className="sticker p-4 space-y-3">
        {connected ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brocco border border-ink" />
              <span className="text-sm text-ink font-bold">{t("settings.connected")} ({t("settings.intervalsAthlete").replace("{id}", connectedId || "")})</span>
            </div>
            <p className="text-xs text-moss">
              {t("settings.watchConnectedHint")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSyncNow}
                disabled={busy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy ? t("settings.working") : t("settings.syncNow")}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="btn-danger px-4 py-2 text-sm disabled:opacity-50"
              >
                {t("settings.disconnect")}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
            >
              {showHelp ? t("settings.hideSetupSteps") : t("settings.howToSetUp")}
            </button>
            {showHelp && (
              <ol className="text-xs text-moss space-y-1.5 list-decimal pl-4">
                <li>
                  {t("settings.setupStep1").split("{link}")[0]}
                  <a href="https://intervals.icu" target="_blank" rel="noreferrer" className="text-leaf font-bold underline">intervals.icu</a>
                  {t("settings.setupStep1").split("{link}")[1]}
                </li>
                <li>
                  <Rich text={t("settings.setupStep2")} />
                </li>
                <li>
                  <Rich text={t("settings.setupStep3")} />
                </li>
                <li>
                  <Rich text={t("settings.setupStep4")} />
                </li>
                <li>{t("settings.setupStep5")}</li>
              </ol>
            )}
            <input
              value={athleteId}
              onChange={(e) => setAthleteId(e.target.value)}
              placeholder={t("settings.athleteIdPlaceholder")}
              className={inputCls}
            />
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t("settings.apiKeyPlaceholder")}
              type="password"
              className={inputCls}
            />
            <button
              onClick={handleConnect}
              disabled={busy || !athleteId.trim() || !apiKey.trim()}
              className="btn-brocco px-4 py-2 text-sm"
            >
              {busy ? t("settings.checking") : t("settings.connectAndSync")}
            </button>
          </>
        )}
        {message && <p className="text-sm text-moss">{message}</p>}
      </div>
    </section>
  );
}

/**
 * IANA timezone picker — a select instead of a free-text input, because one
 * typo ("Europe/berlin") silently breaks every "today" computation for the
 * user. Falls back to a text input on browsers without supportedValuesOf.
 */
function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
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

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Per-device push notification controls. Push reaches the phone even with
 * the app closed — this is what makes event reminders real.
 */
function NotificationSettings() {
  const t = useT();
  const fmt = useFmt();
  const [status, setStatus] = useState<"loading" | "unsupported" | "unconfigured" | "denied" | "off" | "on">("loading");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      try {
        const vapid = await fetch("/api/push/vapid").then((r) => r.json());
        if (!vapid.configured) {
          setStatus("unconfigured");
          return;
        }
        if (Notification.permission === "denied") {
          setStatus("denied");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setStatus(sub ? "on" : "off");
      } catch {
        setStatus("unsupported");
      }
    }
    check();
  }, []);

  async function enable() {
    setBusy(true);
    setTestResult(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await fetch("/api/push/vapid").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error();
      setStatus("on");
    } catch {
      setTestResult(t("settings.enableFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setTestResult(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setTestResult(t("settings.disableFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      setTestResult(res.ok ? fmt.plural(data.sent, t("settings.testSentOne"), t("settings.testSentMany")).replace("{n}", String(data.sent)) : data.error || t("settings.testFailed"));
    } catch {
      setTestResult(t("settings.testFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-extrabold mb-1">{t("settings.notifications")}</h2>
      <p className="text-xs text-moss mb-3">
        {t("settings.notificationsBlurb")}
      </p>
      <div className="sticker p-4 space-y-3">
        {status === "loading" && <p className="text-sm text-moss">{t("settings.checking")}</p>}
        {status === "unsupported" && (
          <p className="text-sm text-moss">
            {t("settings.pushUnsupported")}
          </p>
        )}
        {status === "unconfigured" && (
          <p className="text-sm text-moss">{t("settings.pushUnconfigured")}</p>
        )}
        {status === "denied" && (
          <p className="text-sm text-moss">
            {t("settings.pushDenied")}
          </p>
        )}
        {status === "off" && (
          <button
            onClick={enable}
            disabled={busy}
            className="btn-brocco px-4 py-2 text-sm"
          >
            {busy ? t("settings.enabling") : t("settings.enableOnDevice")}
          </button>
        )}
        {status === "on" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brocco border border-ink" />
              <span className="text-sm text-ink font-bold">{t("settings.enabledOnDevice")}</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={sendTest}
                disabled={busy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                {t("settings.sendTestNotification")}
              </button>
              <button
                onClick={disable}
                disabled={busy}
                className="px-4 py-2 text-sm text-moss font-bold hover:text-ink transition-colors"
              >
                {t("settings.disable")}
              </button>
            </div>
          </div>
        )}
        {testResult && <p className="text-xs text-moss">{testResult}</p>}
      </div>
    </section>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stravaStatus = searchParams.get("strava");

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile edit
  const [editName, setEditName] = useState("");
  const [editTimezone, setEditTimezone] = useState("");
  const [savingLang, setSavingLang] = useState(false);
  const t = useT();
  const lang = useLang();
  const fmt = useFmt();
  const [editGoalRace, setEditGoalRace] = useState("");
  const [editGoalTime, setEditGoalTime] = useState("");
  const [editGoalDate, setEditGoalDate] = useState("");
  const [editHrMax, setEditHrMax] = useState("");
  const [featureFlags, setFeatureFlags] = useState<Features>(ALL_FEATURES);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Email change
  const [emailEditOpen, setEmailEditOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Strava
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // ICS calendar feed
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [icsBusy, setIcsBusy] = useState(false);
  const [icsCopied, setIcsCopied] = useState(false);


  // Password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwResult, setPwResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Delete
  const [showDelete, setShowDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
          setEditName(data.name || "");
          setEditTimezone(data.timezone || "");
          setEditGoalRace(data.goalRace || "");
          setEditGoalTime(data.goalTime || "");
          setEditGoalDate(data.goalRaceDate ? data.goalRaceDate.split("T")[0] : "");
          setEditHrMax(data.hrMaxBpm ? String(data.hrMaxBpm) : "");
          if (data.features) setFeatureFlags(data.features);
          setIcsUrl(data.icsFeedUrl || null);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleProfileSave() {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          timezone: editTimezone,
          goalRace: editGoalRace,
          goalTime: editGoalTime,
          goalRaceDate: editGoalDate || null,
          hrMaxBpm: editHrMax || null,
        }),
      });
      if (res.ok) {
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleEmailChange() {
    setEmailSaving(true);
    setEmailResult(null);
    try {
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, currentPassword: emailPw }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmailResult({ ok: true, msg: t("settings.emailUpdated") });
        if (profile) setProfile({ ...profile, email: data.email });
        setTimeout(() => {
          setEmailEditOpen(false);
          setNewEmail("");
          setEmailPw("");
          setEmailResult(null);
        }, 1500);
      } else {
        setEmailResult({ ok: false, msg: data.error || t("settings.failed") });
      }
    } catch {
      setEmailResult({ ok: false, msg: t("common.somethingWrong") });
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleToggleFeature(key: keyof Features) {
    const next = { ...featureFlags, [key]: !featureFlags[key] };
    setFeatureFlags(next); // optimistic — the switch flips immediately
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: next }),
      });
      if (!res.ok) throw new Error();
      // Navigation & global components re-read the flags; the cached
      // briefing predates the toggle, so force a regeneration in background
      window.dispatchEvent(new Event(FEATURES_CHANGED_EVENT));
      fetch("/api/briefing?refresh=1").catch(() => {});
    } catch {
      setFeatureFlags(featureFlags); // roll back
    }
  }

  async function handleIcsToken(rotate: boolean) {
    setIcsBusy(true);
    try {
      const res = await fetch("/api/calendar/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate }),
      });
      if (res.ok) {
        const data = await res.json();
        setIcsUrl(data.url);
      }
    } catch {
      // ignore
    } finally {
      setIcsBusy(false);
    }
  }

  async function handleIcsCopy() {
    if (!icsUrl) return;
    try {
      await navigator.clipboard.writeText(icsUrl);
      setIcsCopied(true);
      setTimeout(() => setIcsCopied(false), 2000);
    } catch {
      // clipboard unavailable — the URL is selectable in the input
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      setSyncResult(res.ok
        ? (data.newCount > 0
          ? fmt.plural(data.newCount, t("settings.stravaSyncNewOne"), t("settings.stravaSyncNewMany")).replace("{n}", String(data.newCount))
          : t("settings.stravaSyncUpToDate")).replace("{checked}", String(data.totalChecked))
        : (data.error || t("settings.syncFailed")));
    } catch {
      setSyncResult(t("settings.syncFailed"));
    } finally {
      setSyncing(false);
    }
  }


  async function handleStravaDisconnect() {
    if (!confirm(t("settings.stravaDisconnectConfirm"))) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/strava/disconnect", { method: "POST" });
      if (!res.ok) throw new Error();
      setProfile((p) =>
        p
          ? { ...p, stravaConnected: false, stravaAthleteId: null, stravaLastSyncError: null, stravaNeedsReconnect: false }
          : p
      );
    } catch {
      setSyncResult(t("settings.disconnectFailed"));
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Saved on change rather than behind the profile Save button: the whole UI
   * re-renders in the new language immediately, so a "did that apply?" moment
   * would be strange. The provider re-reads via FEATURES_CHANGED_EVENT.
   */
  // Same save-on-change treatment as language: it changes how Brocco talks
  // from the next message, and there is nothing else on the form it belongs to.
  async function handlePrimarySportChange(next: string) {
    setProfile((p) => (p ? { ...p, primarySport: next || null } : p));
    try {
      await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primarySport: next }),
      });
    } catch {
      /* optimistic value stays; next load re-reads */
    }
  }

  async function handleLanguageChange(next: Lang) {
    setSavingLang(true);
    setProfile((p) => (p ? { ...p, language: next } : p));
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      if (!res.ok) throw new Error();
      try { localStorage.setItem("brocco_lang", next); } catch { /* full/blocked */ }
      window.dispatchEvent(new Event(FEATURES_CHANGED_EVENT));
    } catch {
      /* keep the optimistic value; the next load re-reads the server */
    } finally {
      setSavingLang(false);
    }
  }

  async function handlePasswordChange() {
    if (newPw !== confirmPw) {
      setPwResult({ ok: false, msg: t("settings.passwordsDontMatch") });
      return;
    }
    if (newPw.length < 8) {
      setPwResult({ ok: false, msg: t("settings.minChars") });
      return;
    }
    setPwSaving(true);
    setPwResult(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwResult({ ok: true, msg: t("settings.passwordUpdated") });
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
      } else {
        setPwResult({ ok: false, msg: data.error || t("settings.failed") });
      }
    } catch {
      setPwResult({ ok: false, msg: t("common.somethingWrong") });
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deletePw) {
      setDeleteError(t("settings.enterPasswordToConfirm"));
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePw }),
      });
      if (res.ok) {
        router.push("/login");
      } else {
        const data = await res.json();
        setDeleteError(data.error || t("settings.failed"));
      }
    } catch {
      setDeleteError(t("common.somethingWrong"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <div className="text-moss text-center py-12 font-semibold">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-8">
      {/* Strava status banner */}
      {stravaStatus === "connected" && (
        <div className="bg-sprout border-2 border-ink rounded-lg p-3 text-sm text-ink font-bold">
          {t("settings.stravaConnectedBanner")}
        </div>
      )}
      {stravaStatus === "denied" && (
        <div className="bg-[#faeed8] border-2 border-sun rounded-lg p-3 text-sm text-ink font-bold">
          {t("settings.stravaDeniedBanner")}
        </div>
      )}

      {/* Profile */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">{t("settings.profile")}</h2>
        <div className="sticker p-4 space-y-4">
          <div>
            <label className="label-xs block mb-1">{t("settings.name")}</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.email")}</label>
            {!emailEditOpen ? (
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-sm text-moss">{profile?.email}</p>
                <button
                  onClick={() => setEmailEditOpen(true)}
                  className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
                >
                  {t("settings.change")}
                </button>
              </div>
            ) : (
              <div className="space-y-2 bg-ghost border-2 border-ink rounded-lg p-3">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("settings.newEmailPlaceholder")}
                  autoFocus
                  className="field"
                />
                <input
                  type="password"
                  value={emailPw}
                  onChange={(e) => setEmailPw(e.target.value)}
                  placeholder={t("settings.currentPasswordConfirm")}
                  className="field"
                />
                <p className="text-[11px] text-moss">
                  {t("settings.emailNote")}
                </p>
                {emailResult && (
                  <p className={`text-xs font-bold ${emailResult.ok ? "text-leaf" : "text-clay"}`}>{emailResult.msg}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEmailEditOpen(false); setNewEmail(""); setEmailPw(""); setEmailResult(null); }}
                    className="btn-quiet px-3 py-1.5 text-xs"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleEmailChange}
                    disabled={emailSaving || !newEmail.trim() || !emailPw}
                    className="btn-brocco px-3 py-1.5 text-xs"
                  >
                    {emailSaving ? t("common.saving") : t("settings.saveEmail")}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.timezone")}</label>
            <TimezonePicker value={editTimezone} onChange={setEditTimezone} />
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.language")}</label>
            <select
              value={profile?.language || lang}
              onChange={(e) => handleLanguageChange(e.target.value as Lang)}
              disabled={savingLang}
              className="field"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                  {!profile?.language && l === detectLang() ? " ·" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-moss font-semibold mt-1">{t("settings.languageHint")}</p>
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.primarySport")}</label>
            <select
              value={PRIMARY_SPORTS.includes(profile?.primarySport || "") ? profile?.primarySport || "" : profile?.primarySport ? "__custom" : ""}
              onChange={(e) => { if (e.target.value !== "__custom") handlePrimarySportChange(e.target.value); }}
              className="field"
            >
              {PRIMARY_SPORTS.map((sp) => (
                <option key={sp} value={sp}>{t(`sport.${sp || "running"}` as Parameters<typeof t>[0])}</option>
              ))}
              {profile?.primarySport && !PRIMARY_SPORTS.includes(profile.primarySport) && (
                <option value="__custom">{profile.primarySport}</option>
              )}
            </select>
            <p className="text-xs text-moss font-semibold mt-1">{t("settings.primarySportHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-xs block mb-1">{t("settings.goalRace")}</label>
              <input
                value={editGoalRace}
                onChange={(e) => setEditGoalRace(e.target.value)}
                placeholder={t("settings.goalRacePlaceholder")}
                className="field"
              />
            </div>
            <div>
              <label className="label-xs block mb-1">{t("settings.goalTime")}</label>
              <input
                value={editGoalTime}
                onChange={(e) => setEditGoalTime(e.target.value)}
                placeholder={t("settings.goalTimePlaceholder")}
                className="field"
              />
            </div>
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.raceDate")}</label>
            <input
              type="date"
              value={editGoalDate}
              onChange={(e) => setEditGoalDate(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label-xs block mb-1">{t("settings.maxHr")} {t("settings.maxHrUnit")}</label>
            <input
              type="number"
              inputMode="numeric"
              min={100}
              max={230}
              value={editHrMax}
              onChange={(e) => setEditHrMax(e.target.value)}
              placeholder={t("settings.maxHrPlaceholder")}
              className="field"
            />
            <p className="text-[11px] text-sage mt-1">
              {t("settings.maxHrHint")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="btn-brocco px-4 py-2 text-sm"
            >
              {profileSaving ? t("common.saving") : t("settings.saveChanges")}
            </button>
            {profileSaved && (
              <span className="text-sm text-leaf font-bold">{t("common.saved")}</span>
            )}
          </div>
        </div>
      </section>

      {/* Equipment — what Brocco can prescribe with */}
      <div className="mb-6">
        <EquipmentSection />
      </div>

      {/* Features */}
      <section>
        <h2 className="text-lg font-extrabold mb-1">{t("settings.features")}</h2>
        <p className="text-xs text-moss mb-3">
          {t("settings.featuresBlurb")}
        </p>
        <div className="sticker divide-y-2 divide-shade/40">
          {([
            ["calendar", t("nav.calendar"), t("settings.calendarFeatureDesc")],
            ["kitchen", t("nav.kitchen"), t("more.kitchenDesc")],
          ] as Array<[keyof Features, string, string]>).map(([key, label, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-ink">{label}</p>
                <p className="text-xs text-moss">{desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={featureFlags[key]}
                aria-label={`${label} ${featureFlags[key] ? t("settings.enabled") : t("settings.disabled")}`}
                onClick={() => handleToggleFeature(key)}
                className={`relative w-11 h-6 rounded-full border-2 border-ink transition-colors flex-shrink-0 ${
                  featureFlags[key] ? "bg-brocco" : "bg-ghost"
                }`}
              >
                <span
                  className={`absolute left-0 top-0 w-5 h-5 bg-card border-2 border-ink rounded-full transition-transform ${
                    featureFlags[key] ? "translate-x-[20px]" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Calendar feed */}
      {featureFlags.calendar && (
        <section>
          <h2 className="text-lg font-extrabold mb-1">{t("settings.calendarFeed")}</h2>
          <p className="text-xs text-moss mb-3">
            {t("settings.calendarFeedBlurb")}
          </p>
          <div className="sticker p-4 space-y-3">
            {icsUrl ? (
              <>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={icsUrl}
                    onFocus={(e) => e.target.select()}
                    className="field flex-1 text-xs!"
                  />
                  <button
                    onClick={handleIcsCopy}
                    className="btn-quiet px-3 py-2 text-xs flex-shrink-0"
                  >
                    {icsCopied ? t("settings.copied") : t("settings.copy")}
                  </button>
                </div>
                <p className="text-[11px] text-sage">
                  {t("settings.calendarFeedHowTo")}{" "}
                  {t("settings.feedLeakBefore")}{" "}
                  <button
                    onClick={() => handleIcsToken(true)}
                    disabled={icsBusy}
                    className="text-moss hover:text-ink underline underline-offset-2 disabled:opacity-50"
                  >
                    {t("settings.regenerateIt")}
                  </button>{" "}
                  {t("settings.feedLeakAfter")}
                </p>
              </>
            ) : (
              <button
                onClick={() => handleIcsToken(false)}
                disabled={icsBusy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                {icsBusy ? t("settings.creating") : t("settings.createSubscribeLink")}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Notifications */}
      <NotificationSettings />

      {/* Strava */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">{t("settings.strava")}</h2>
        <div className="sticker p-4">
          {profile?.stravaConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full border border-ink ${profile.stravaNeedsReconnect ? "bg-clay" : "bg-brocco"}`} />
                <span className="text-sm text-ink font-bold">
                  {t("settings.connected")} ({t("settings.stravaAthlete").replace("{id}", profile.stravaAthleteId || "")})
                </span>
              </div>
              {/* Sync health — was completely invisible before: a dead token
                  just meant runs silently stopped appearing */}
              {profile.stravaNeedsReconnect ? (
                <div className="bg-clay-soft border-2 border-clay rounded-lg px-3 py-2">
                  <p className="text-xs font-bold text-clay">
                    {t("settings.stravaExpired")}
                  </p>
                  <a
                    href="/api/strava/auth"
                    className="inline-block mt-1.5 text-xs font-extrabold text-ink underline underline-offset-2"
                  >
                    {t("settings.reconnectStrava")}
                  </a>
                </div>
              ) : (
                <p className="text-xs text-sage font-semibold">
                  {t("settings.lastSynced")}:{" "}
                  {profile.stravaLastSyncAt
                    ? fmt.date(profile.stravaLastSyncAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                    : t("settings.never")}
                  {profile.stravaLastSyncError ? (
                    <span className="text-clay font-bold"> · {t("settings.lastAttemptFailed")}: {profile.stravaLastSyncError}</span>
                  ) : null}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
                >
                  {syncing ? t("settings.syncing") : t("settings.syncNow")}
                </button>
                <button
                  onClick={handleStravaDisconnect}
                  disabled={syncing}
                  className="btn-quiet px-4 py-2 text-sm text-clay disabled:opacity-50"
                >
                  {t("settings.disconnect")}
                </button>
              </div>
              {syncResult && (
                <p className="text-sm text-moss">{syncResult}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-moss">
                {t("settings.connectStravaHint")}
              </p>
              <a
                href="/api/strava/auth"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FC4C02] hover:bg-[#e04400] text-cream font-bold border-2 border-ink rounded-xl shadow-[2px_2px_0_var(--color-shade)] transition-colors text-sm"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
                {t("settings.connectWithStrava")}
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Watch sync (intervals.icu bridge) */}
      {profile && <WatchSyncSection profile={profile} />}

      {/* Change Password */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">{t("settings.changePassword")}</h2>
        <div className="sticker p-4 space-y-3">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder={t("settings.currentPassword")}
            className="field"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={t("settings.newPasswordPlaceholder")}
            className="field"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder={t("settings.confirmNewPassword")}
            className="field"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
            >
              {pwSaving ? t("settings.updating") : t("settings.updatePassword")}
            </button>
            {pwResult && (
              <span className={`text-sm font-bold ${pwResult.ok ? "text-leaf" : "text-clay"}`}>
                {pwResult.msg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Account */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">{t("settings.account")}</h2>
        <div className="sticker p-4 space-y-4">
          <button
            onClick={handleLogout}
            className="btn-quiet px-4 py-2 text-sm"
          >
            {t("settings.logout")}
          </button>

          <div className="border-t-2 border-shade pt-4">
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="text-sm text-clay font-bold hover:opacity-70 transition-opacity"
              >
                {t("settings.deleteAccount")}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-clay">
                  {t("settings.deleteWarning")}
                </p>
                <input
                  type="password"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  placeholder={t("settings.enterPasswordToConfirm")}
                  className="field border-clay!"
                />
                {deleteError && (
                  <p className="text-sm text-clay">{deleteError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || !deletePw}
                    className="btn-danger px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {deleting ? t("settings.deleting") : t("settings.deleteMyAccount")}
                  </button>
                  <button
                    onClick={() => { setShowDelete(false); setDeletePw(""); setDeleteError(""); }}
                    className="btn-quiet px-4 py-2 text-sm"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Install App */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">{t("settings.installApp")}</h2>
        <div className="sticker p-4">
          <p className="text-sm text-moss mb-3">{t("settings.installBlurb")}</p>
          <InstallInstructions />
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  return (
    <main className="min-h-screen max-w-lg mx-auto px-4 py-6 pb-24">
      <div className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-6 border-b-2 border-ink/10">
        {/* Mobile: minimal */}
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
          <span className="font-extrabold text-sm text-ink">{t("settings.title")}</span>
        </div>
        {/* Desktop: full */}
        <div className="hidden md:flex items-center justify-between py-3">
          <h1 className="text-2xl font-extrabold">{t("settings.title")}</h1>
          <DesktopNavLinks />
        </div>
      </div>

      <Suspense fallback={<div className="text-moss text-center py-12 font-semibold">{t("common.loading")}</div>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
