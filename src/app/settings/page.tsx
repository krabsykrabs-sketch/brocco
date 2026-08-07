"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { InstallInstructions } from "@/app/pwa-banner";
import { DesktopNavLinks } from "@/app/nav";
import { FEATURES_CHANGED_EVENT } from "@/app/features-provider";
import { ALL_FEATURES, type Features } from "@/lib/features";
import { EquipmentSection } from "./equipment-section";
import { Suspense } from "react";


interface ProfileData {
  name: string;
  email: string;
  stravaConnected: boolean;
  stravaAthleteId: string | null;
  intervalsConnected: boolean;
  intervalsAthleteId: string | null;
  timezone: string;
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
function describeSync(d: SyncData): string {
  const changed = (d.created || 0) + (d.updated || 0) + (d.deleted || 0);
  if (changed > 0) {
    return `Synced: ${d.created || 0} new, ${d.updated || 0} updated, ${d.deleted || 0} removed.`;
  }
  // Nothing changed — say why.
  if (d.hasActivePlan === false) {
    return "No active training plan yet — build one with Brocco, then its upcoming workouts sync here.";
  }
  if ((d.desiredCount || 0) > 0) {
    return `Already up to date — all ${d.desiredCount} upcoming workout${d.desiredCount === 1 ? "" : "s"} are on your intervals.icu calendar. If they're not on your watch, open intervals.icu → your COROS/Garmin connection and turn on “Upload planned workouts”.`;
  }
  if ((d.windowWorkouts || 0) === 0) {
    return "No runs scheduled in the next 2 weeks, so there's nothing to push. Watch sync only sends the upcoming 14 days.";
  }
  // Workouts exist in the window but none were syncable.
  const bits: string[] = [];
  if (d.skippedType) bits.push(`${d.skippedType} aren't run/ride (strength & co. stay in the app)`);
  if (d.skippedNoTarget) bits.push(`${d.skippedNoTarget} have no distance or pace target`);
  const why = bits.length ? ` — ${bits.join(", ")}` : "";
  return `Found ${d.windowWorkouts} workout${d.windowWorkouts === 1 ? "" : "s"} in the next 2 weeks but none could go to your watch${why}.`;
}

/**
 * Watch sync via intervals.icu — planned workouts are pushed to the user's
 * intervals.icu calendar, which forwards them to COROS / Garmin / Wahoo /
 * Polar / Suunto with full interval structure.
 */
function WatchSyncSection({ profile }: { profile: ProfileData }) {
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
        setMessage(data.error || "Connection failed");
        return;
      }
      const s = data.initialSync;
      setMessage(
        `Connected${data.athleteName ? ` as ${data.athleteName}` : ""}.` +
          (s?.synced ? ` ${describeSync(s)}` : "")
      );
      setConnected(true);
      setConnectedId(athleteId.trim());
      setAthleteId("");
      setApiKey("");
    } catch {
      setMessage("Connection failed — try again.");
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
      setMessage(res.ok ? describeSync(data) : data.error || "Sync failed");
    } catch {
      setMessage("Sync failed — try again.");
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
      <h2 className="text-lg font-extrabold mb-1">Watch sync</h2>
      <p className="text-xs text-moss mb-3">
        Your planned workouts on your COROS or Garmin — intervals, paces, and all — via a free intervals.icu account.
      </p>
      <div className="sticker p-4 space-y-3">
        {connected ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brocco border border-ink" />
              <span className="text-sm text-ink font-bold">Connected (intervals.icu athlete {connectedId})</span>
            </div>
            <p className="text-xs text-moss">
              Upcoming workouts (next 2 weeks) sync automatically whenever your plan changes. Your watch picks them up
              from intervals.icu — make sure your watch is connected there with &quot;Upload planned workouts&quot; on.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSyncNow}
                disabled={busy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy ? "Working…" : "Sync Now"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="btn-danger px-4 py-2 text-sm disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
            >
              {showHelp ? "Hide setup steps" : "How do I set this up? (one-time, ~3 minutes)"}
            </button>
            {showHelp && (
              <ol className="text-xs text-moss space-y-1.5 list-decimal pl-4">
                <li>
                  Create a free account at{" "}
                  <a href="https://intervals.icu" target="_blank" rel="noreferrer" className="text-leaf font-bold underline">intervals.icu</a>
                </li>
                <li>
                  In intervals.icu <b>Settings</b>, scroll to your watch brand (COROS / Garmin / …), connect it, and tick{" "}
                  <b>&quot;Upload planned workouts&quot;</b>
                </li>
                <li>
                  Still in Settings, open <b>Developer Settings</b> and generate an <b>API key</b>
                </li>
                <li>
                  Your <b>Athlete ID</b> is shown right there (looks like <code className="text-ink font-bold">i1234567</code>)
                </li>
                <li>Paste both below</li>
              </ol>
            )}
            <input
              value={athleteId}
              onChange={(e) => setAthleteId(e.target.value)}
              placeholder="Athlete ID (e.g. i1234567)"
              className={inputCls}
            />
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              type="password"
              className={inputCls}
            />
            <button
              onClick={handleConnect}
              disabled={busy || !athleteId.trim() || !apiKey.trim()}
              className="btn-brocco px-4 py-2 text-sm"
            >
              {busy ? "Checking…" : "Connect & sync"}
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
          placeholder="e.g. Europe/Berlin"
          className={inputCls}
        />
      )}
      {deviceTz && deviceTz !== value && (
        <button
          type="button"
          onClick={() => onChange(deviceTz)}
          className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
        >
          Use device timezone ({deviceTz})
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
      setTestResult("Couldn't enable notifications — try again.");
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
      setTestResult("Couldn't disable — try again.");
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
      setTestResult(res.ok ? `Sent to ${data.sent} device${data.sent === 1 ? "" : "s"} — check your notifications.` : data.error || "Test failed");
    } catch {
      setTestResult("Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-extrabold mb-1">Notifications</h2>
      <p className="text-xs text-moss mb-3">
        Event reminders on this device — even when the app is closed.
      </p>
      <div className="sticker p-4 space-y-3">
        {status === "loading" && <p className="text-sm text-moss">Checking…</p>}
        {status === "unsupported" && (
          <p className="text-sm text-moss">
            This browser doesn&apos;t support push notifications. On iPhone, add brocco.run to your home screen first.
          </p>
        )}
        {status === "unconfigured" && (
          <p className="text-sm text-moss">Push isn&apos;t configured on the server yet.</p>
        )}
        {status === "denied" && (
          <p className="text-sm text-moss">
            Notifications are blocked for brocco.run — allow them in your browser&apos;s site settings, then reload.
          </p>
        )}
        {status === "off" && (
          <button
            onClick={enable}
            disabled={busy}
            className="btn-brocco px-4 py-2 text-sm"
          >
            {busy ? "Enabling..." : "Enable on this device"}
          </button>
        )}
        {status === "on" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brocco border border-ink" />
              <span className="text-sm text-ink font-bold">Enabled on this device</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={sendTest}
                disabled={busy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                Send test notification
              </button>
              <button
                onClick={disable}
                disabled={busy}
                className="px-4 py-2 text-sm text-moss font-bold hover:text-ink transition-colors"
              >
                Disable
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
        setEmailResult({ ok: true, msg: "Email updated" });
        if (profile) setProfile({ ...profile, email: data.email });
        setTimeout(() => {
          setEmailEditOpen(false);
          setNewEmail("");
          setEmailPw("");
          setEmailResult(null);
        }, 1500);
      } else {
        setEmailResult({ ok: false, msg: data.error || "Failed" });
      }
    } catch {
      setEmailResult({ ok: false, msg: "Something went wrong" });
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
          ? `${data.newCount} new ${data.newCount === 1 ? "activity" : "activities"} added (${data.totalChecked} checked)`
          : `All up to date (${data.totalChecked} checked)`)
        : (data.error || "Sync failed"));
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
    }
  }


  async function handlePasswordChange() {
    if (newPw !== confirmPw) {
      setPwResult({ ok: false, msg: "Passwords don't match" });
      return;
    }
    if (newPw.length < 8) {
      setPwResult({ ok: false, msg: "Minimum 8 characters" });
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
        setPwResult({ ok: true, msg: "Password updated" });
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
      } else {
        setPwResult({ ok: false, msg: data.error || "Failed" });
      }
    } catch {
      setPwResult({ ok: false, msg: "Something went wrong" });
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deletePw) {
      setDeleteError("Enter your password to confirm");
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
        setDeleteError(data.error || "Failed");
      }
    } catch {
      setDeleteError("Something went wrong");
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
    return <div className="text-moss text-center py-12 font-semibold">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Strava status banner */}
      {stravaStatus === "connected" && (
        <div className="bg-sprout border-2 border-ink rounded-lg p-3 text-sm text-ink font-bold">
          Strava connected successfully.
        </div>
      )}
      {stravaStatus === "denied" && (
        <div className="bg-[#faeed8] border-2 border-sun rounded-lg p-3 text-sm text-ink font-bold">
          Strava authorization was denied.
        </div>
      )}

      {/* Profile */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">Profile</h2>
        <div className="sticker p-4 space-y-4">
          <div>
            <label className="label-xs block mb-1">Name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label-xs block mb-1">Email</label>
            {!emailEditOpen ? (
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-sm text-moss">{profile?.email}</p>
                <button
                  onClick={() => setEmailEditOpen(true)}
                  className="text-xs text-leaf font-bold underline underline-offset-2 hover:opacity-70"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2 bg-ghost border-2 border-ink rounded-lg p-3">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@email.com"
                  autoFocus
                  className="field"
                />
                <input
                  type="password"
                  value={emailPw}
                  onChange={(e) => setEmailPw(e.target.value)}
                  placeholder="Current password (to confirm)"
                  className="field"
                />
                <p className="text-[11px] text-moss">
                  This is your login and where password-reset links go — make sure it&apos;s an inbox you can read.
                </p>
                {emailResult && (
                  <p className={`text-xs font-bold ${emailResult.ok ? "text-leaf" : "text-clay"}`}>{emailResult.msg}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEmailEditOpen(false); setNewEmail(""); setEmailPw(""); setEmailResult(null); }}
                    className="btn-quiet px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEmailChange}
                    disabled={emailSaving || !newEmail.trim() || !emailPw}
                    className="btn-brocco px-3 py-1.5 text-xs"
                  >
                    {emailSaving ? "Saving..." : "Save email"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="label-xs block mb-1">Timezone</label>
            <TimezonePicker value={editTimezone} onChange={setEditTimezone} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-xs block mb-1">Goal race</label>
              <input
                value={editGoalRace}
                onChange={(e) => setEditGoalRace(e.target.value)}
                placeholder="e.g. Valencia Marathon"
                className="field"
              />
            </div>
            <div>
              <label className="label-xs block mb-1">Target time</label>
              <input
                value={editGoalTime}
                onChange={(e) => setEditGoalTime(e.target.value)}
                placeholder="e.g. Sub 3:00"
                className="field"
              />
            </div>
          </div>
          <div>
            <label className="label-xs block mb-1">Race date</label>
            <input
              type="date"
              value={editGoalDate}
              onChange={(e) => setEditGoalDate(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label-xs block mb-1">Max heart rate (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              min={100}
              max={230}
              value={editHrMax}
              onChange={(e) => setEditHrMax(e.target.value)}
              placeholder="e.g. 188"
              className="field"
            />
            <p className="text-[11px] text-sage mt-1">
              Used to compute heart rate zones for intensity analysis. If left blank, Brocco estimates it from your highest recorded heart rate.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="btn-brocco px-4 py-2 text-sm"
            >
              {profileSaving ? "Saving..." : "Save changes"}
            </button>
            {profileSaved && (
              <span className="text-sm text-leaf font-bold">Saved</span>
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
        <h2 className="text-lg font-extrabold mb-1">Features</h2>
        <p className="text-xs text-moss mb-3">
          Switch off what you don&apos;t use — navigation, the Today screen, and Brocco adapt.
          With everything off you get the classic running-coach experience. Your data is kept, just hidden.
        </p>
        <div className="sticker divide-y-2 divide-shade/40">
          {([
            ["calendar", "Calendar", "Events, birthdays, and reminders"],
            ["kitchen", "Kitchen", "Recipe library, photo scans, cooking ideas"],
          ] as Array<[keyof Features, string, string]>).map(([key, label, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-ink">{label}</p>
                <p className="text-xs text-moss">{desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={featureFlags[key]}
                aria-label={`${label} ${featureFlags[key] ? "enabled" : "disabled"}`}
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
          <h2 className="text-lg font-extrabold mb-1">Calendar feed</h2>
          <p className="text-xs text-moss mb-3">
            Subscribe from Google or Apple Calendar to see your brocco events and workouts there (read-only).
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
                    {icsCopied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <p className="text-[11px] text-sage">
                  Google Calendar: Other calendars → + → From URL. Apple Calendar: File → New Calendar Subscription.
                  Anyone with this link can read your calendar —{" "}
                  <button
                    onClick={() => handleIcsToken(true)}
                    disabled={icsBusy}
                    className="text-moss hover:text-ink underline underline-offset-2 disabled:opacity-50"
                  >
                    regenerate it
                  </button>{" "}
                  if it ever leaks (the old link stops working).
                </p>
              </>
            ) : (
              <button
                onClick={() => handleIcsToken(false)}
                disabled={icsBusy}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
              >
                {icsBusy ? "Creating..." : "Create subscribe link"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Notifications */}
      <NotificationSettings />

      {/* Strava */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">Strava</h2>
        <div className="sticker p-4">
          {profile?.stravaConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-brocco border border-ink" />
                <span className="text-sm text-ink font-bold">
                  Connected (Athlete {profile.stravaAthleteId})
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
                >
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
              {syncResult && (
                <p className="text-sm text-moss">{syncResult}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-moss">
                Connect your Strava account to import activities.
              </p>
              <a
                href="/api/strava/auth"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FC4C02] hover:bg-[#e04400] text-cream font-bold border-2 border-ink rounded-xl shadow-[2px_2px_0_var(--color-shade)] transition-colors text-sm"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
                Connect with Strava
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Watch sync (intervals.icu bridge) */}
      {profile && <WatchSyncSection profile={profile} />}

      {/* Change Password */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">Change Password</h2>
        <div className="sticker p-4 space-y-3">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="field"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min. 8 chars)"
            className="field"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            className="field"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="btn-quiet px-4 py-2 text-sm disabled:opacity-50"
            >
              {pwSaving ? "Updating..." : "Update Password"}
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
        <h2 className="text-lg font-extrabold mb-3">Account</h2>
        <div className="sticker p-4 space-y-4">
          <button
            onClick={handleLogout}
            className="btn-quiet px-4 py-2 text-sm"
          >
            Log out
          </button>

          <div className="border-t-2 border-shade pt-4">
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="text-sm text-clay font-bold hover:opacity-70 transition-opacity"
              >
                Delete account
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-clay">
                  This will permanently delete all your data including activities, plans, and chat history. This cannot be undone.
                </p>
                <input
                  type="password"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  placeholder="Enter your password to confirm"
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
                    {deleting ? "Deleting..." : "Delete my account"}
                  </button>
                  <button
                    onClick={() => { setShowDelete(false); setDeletePw(""); setDeleteError(""); }}
                    className="btn-quiet px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Install App */}
      <section>
        <h2 className="text-lg font-extrabold mb-3">Install App</h2>
        <div className="sticker p-4">
          <p className="text-sm text-moss mb-3">Add brocco.run to your home screen for the best experience — it works like a regular app.</p>
          <InstallInstructions />
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="min-h-screen max-w-lg mx-auto px-4 py-6 pb-24">
      <div className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-6 border-b-2 border-ink/10">
        {/* Mobile: minimal */}
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
          <span className="font-extrabold text-sm text-ink">Settings</span>
        </div>
        {/* Desktop: full */}
        <div className="hidden md:flex items-center justify-between py-3">
          <h1 className="text-2xl font-extrabold">Settings</h1>
          <DesktopNavLinks />
        </div>
      </div>

      <Suspense fallback={<div className="text-moss text-center py-12 font-semibold">Loading...</div>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
