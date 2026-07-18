"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { InstallInstructions } from "@/app/pwa-banner";
import { DesktopNavLinks } from "@/app/nav";
import { FEATURES_CHANGED_EVENT } from "@/app/features-provider";
import { ALL_FEATURES, type Features } from "@/lib/features";
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
          (s?.synced ? ` Pushed ${s.created || 0} workout${(s.created || 0) === 1 ? "" : "s"} to your calendar.` : "")
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
      setMessage(
        res.ok
          ? `Synced: ${data.created || 0} new, ${data.updated || 0} updated, ${data.deleted || 0} removed.`
          : data.error || "Sync failed"
      );
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

  const inputCls = "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500";

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Watch sync</h2>
      <p className="text-xs text-gray-500 mb-3">
        Your planned workouts on your COROS or Garmin — intervals, paces, and all — via a free intervals.icu account.
      </p>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        {connected ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-gray-300">Connected (intervals.icu athlete {connectedId})</span>
            </div>
            <p className="text-xs text-gray-500">
              Upcoming workouts (next 2 weeks) sync automatically whenever your plan changes. Your watch picks them up
              from intervals.icu — make sure your watch is connected there with &quot;Upload planned workouts&quot; on.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSyncNow}
                disabled={busy}
                className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {busy ? "Working…" : "Sync Now"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="px-4 py-2 text-sm bg-red-900/40 hover:bg-red-900/60 text-red-300 disabled:opacity-50 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2"
            >
              {showHelp ? "Hide setup steps" : "How do I set this up? (one-time, ~3 minutes)"}
            </button>
            {showHelp && (
              <ol className="text-xs text-gray-400 space-y-1.5 list-decimal pl-4">
                <li>
                  Create a free account at{" "}
                  <a href="https://intervals.icu" target="_blank" rel="noreferrer" className="text-green-400 underline">intervals.icu</a>
                </li>
                <li>
                  In intervals.icu <b>Settings</b>, scroll to your watch brand (COROS / Garmin / …), connect it, and tick{" "}
                  <b>&quot;Upload planned workouts&quot;</b>
                </li>
                <li>
                  Still in Settings, open <b>Developer Settings</b> and generate an <b>API key</b>
                </li>
                <li>
                  Your <b>Athlete ID</b> is shown right there (looks like <code className="text-gray-300">i1234567</code>)
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
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {busy ? "Checking…" : "Connect & sync"}
            </button>
          </>
        )}
        {message && <p className="text-sm text-gray-400">{message}</p>}
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

  const inputCls = "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500";

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
          className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2"
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
      <h2 className="text-lg font-semibold mb-1">Notifications</h2>
      <p className="text-xs text-gray-500 mb-3">
        Event reminders on this device — even when the app is closed.
      </p>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        {status === "loading" && <p className="text-sm text-gray-500">Checking…</p>}
        {status === "unsupported" && (
          <p className="text-sm text-gray-500">
            This browser doesn&apos;t support push notifications. On iPhone, add brocco.run to your home screen first.
          </p>
        )}
        {status === "unconfigured" && (
          <p className="text-sm text-gray-500">Push isn&apos;t configured on the server yet.</p>
        )}
        {status === "denied" && (
          <p className="text-sm text-gray-500">
            Notifications are blocked for brocco.run — allow them in your browser&apos;s site settings, then reload.
          </p>
        )}
        {status === "off" && (
          <button
            onClick={enable}
            disabled={busy}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {busy ? "Enabling..." : "Enable on this device"}
          </button>
        )}
        {status === "on" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-gray-300">Enabled on this device</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={sendTest}
                disabled={busy}
                className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg transition-colors"
              >
                Send test notification
              </button>
              <button
                onClick={disable}
                disabled={busy}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Disable
              </button>
            </div>
          </div>
        )}
        {testResult && <p className="text-xs text-gray-400">{testResult}</p>}
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
    return <div className="text-gray-500 text-center py-12">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Strava status banner */}
      {stravaStatus === "connected" && (
        <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 text-sm text-green-300">
          Strava connected successfully.
        </div>
      )}
      {stravaStatus === "denied" && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-sm text-yellow-300">
          Strava authorization was denied.
        </div>
      )}

      {/* Profile */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Email</label>
            {!emailEditOpen ? (
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-sm text-gray-400">{profile?.email}</p>
                <button
                  onClick={() => setEmailEditOpen(true)}
                  className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2 bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@email.com"
                  autoFocus
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <input
                  type="password"
                  value={emailPw}
                  onChange={(e) => setEmailPw(e.target.value)}
                  placeholder="Current password (to confirm)"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-[11px] text-gray-500">
                  This is your login and where password-reset links go — make sure it&apos;s an inbox you can read.
                </p>
                {emailResult && (
                  <p className={`text-xs ${emailResult.ok ? "text-green-400" : "text-red-400"}`}>{emailResult.msg}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEmailEditOpen(false); setNewEmail(""); setEmailPw(""); setEmailResult(null); }}
                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEmailChange}
                    disabled={emailSaving || !newEmail.trim() || !emailPw}
                    className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg transition-colors"
                  >
                    {emailSaving ? "Saving..." : "Save email"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Timezone</label>
            <TimezonePicker value={editTimezone} onChange={setEditTimezone} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Goal race</label>
              <input
                value={editGoalRace}
                onChange={(e) => setEditGoalRace(e.target.value)}
                placeholder="e.g. Valencia Marathon"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Target time</label>
              <input
                value={editGoalTime}
                onChange={(e) => setEditGoalTime(e.target.value)}
                placeholder="e.g. Sub 3:00"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Race date</label>
            <input
              type="date"
              value={editGoalDate}
              onChange={(e) => setEditGoalDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Max heart rate (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              min={100}
              max={230}
              value={editHrMax}
              onChange={(e) => setEditHrMax(e.target.value)}
              placeholder="e.g. 188"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-600 mt-1">
              Used to compute heart rate zones for intensity analysis. If left blank, Brocco estimates it from your highest recorded heart rate.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {profileSaving ? "Saving..." : "Save changes"}
            </button>
            {profileSaved && (
              <span className="text-sm text-green-400">Saved</span>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Features</h2>
        <p className="text-xs text-gray-500 mb-3">
          Switch off what you don&apos;t use — navigation, the Today screen, and Brocco adapt.
          With everything off you get the classic running-coach experience. Your data is kept, just hidden.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
          {([
            ["calendar", "Calendar", "Events, birthdays, and reminders"],
            ["notes", "Notes", "Quick facts and reference lists"],
            ["kitchen", "Kitchen", "Recipe library, photo scans, cooking ideas"],
          ] as Array<[keyof Features, string, string]>).map(([key, label, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={featureFlags[key]}
                aria-label={`${label} ${featureFlags[key] ? "enabled" : "disabled"}`}
                onClick={() => handleToggleFeature(key)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  featureFlags[key] ? "bg-green-600" : "bg-gray-700"
                }`}
              >
                <span
                  className={`absolute left-0 top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    featureFlags[key] ? "translate-x-[22px]" : "translate-x-0.5"
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
          <h2 className="text-lg font-semibold mb-1">Calendar feed</h2>
          <p className="text-xs text-gray-500 mb-3">
            Subscribe from Google or Apple Calendar to see your brocco events and workouts there (read-only).
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            {icsUrl ? (
              <>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={icsUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none"
                  />
                  <button
                    onClick={handleIcsCopy}
                    className="px-3 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors flex-shrink-0"
                  >
                    {icsCopied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-600">
                  Google Calendar: Other calendars → + → From URL. Apple Calendar: File → New Calendar Subscription.
                  Anyone with this link can read your calendar —{" "}
                  <button
                    onClick={() => handleIcsToken(true)}
                    disabled={icsBusy}
                    className="text-gray-500 hover:text-gray-300 underline underline-offset-2 disabled:opacity-50"
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
                className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg transition-colors"
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
        <h2 className="text-lg font-semibold mb-3">Strava</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          {profile?.stravaConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm text-gray-300">
                  Connected (Athlete {profile.stravaAthleteId})
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
              {syncResult && (
                <p className="text-sm text-gray-400">{syncResult}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Connect your Strava account to import activities.
              </p>
              <a
                href="/api/strava/auth"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FC4C02] hover:bg-[#e04400] text-white font-semibold rounded-md transition-colors text-sm"
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
        <h2 className="text-lg font-semibold mb-3">Change Password</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min. 8 chars)"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {pwSaving ? "Updating..." : "Update Password"}
            </button>
            {pwResult && (
              <span className={`text-sm ${pwResult.ok ? "text-green-400" : "text-red-400"}`}>
                {pwResult.msg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Account */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Account</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            Log out
          </button>

          <div className="border-t border-gray-800 pt-4">
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Delete account
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-400">
                  This will permanently delete all your data including activities, plans, and chat history. This cannot be undone.
                </p>
                <input
                  type="password"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  placeholder="Enter your password to confirm"
                  className="w-full px-3 py-2 bg-gray-800 border border-red-900 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                {deleteError && (
                  <p className="text-sm text-red-400">{deleteError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || !deletePw}
                    className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    {deleting ? "Deleting..." : "Delete my account"}
                  </button>
                  <button
                    onClick={() => { setShowDelete(false); setDeletePw(""); setDeleteError(""); }}
                    className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
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
        <h2 className="text-lg font-semibold mb-3">Install App</h2>
        <div className="bg-gray-900 rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-3">Add brocco.run to your home screen for the best experience — it works like a regular app.</p>
          <InstallInstructions />
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="min-h-screen max-w-lg mx-auto px-4 py-6 pb-24">
      <div className="safe-top sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm -mx-4 px-4 mb-6">
        {/* Mobile: minimal */}
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6" />
          <span className="font-semibold text-sm text-gray-300">Settings</span>
        </div>
        {/* Desktop: full */}
        <div className="hidden md:flex items-center justify-between py-3">
          <h1 className="text-2xl font-bold">Settings</h1>
          <DesktopNavLinks />
        </div>
      </div>

      <Suspense fallback={<div className="text-gray-500 text-center py-12">Loading...</div>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
