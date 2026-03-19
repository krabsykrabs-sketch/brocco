"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { InstallInstructions } from "@/app/pwa-banner";
import { Suspense } from "react";

interface InviteCodeData {
  id: string;
  code: string;
  used: boolean;
  usedByName: string | null;
  createdAt: string;
}

interface ProfileData {
  name: string;
  email: string;
  stravaConnected: boolean;
  stravaAthleteId: string | null;
  timezone: string;
  goalRace: string | null;
  goalTime: string | null;
  goalRaceDate: string | null;
  inviteCodes: InviteCodeData[];
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
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Strava
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Invite
  const [generatingInvite, setGeneratingInvite] = useState(false);

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

  async function handleGenerateInvite() {
    setGeneratingInvite(true);
    try {
      const res = await fetch("/api/auth/invite", { method: "POST" });
      const data = await res.json();
      if (res.ok && profile) {
        setProfile({
          ...profile,
          inviteCodes: [
            { id: Date.now().toString(), code: data.code, used: false, usedByName: null, createdAt: new Date().toISOString() },
            ...profile.inviteCodes,
          ],
        });
      }
    } catch {
      // ignore
    } finally {
      setGeneratingInvite(false);
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
            <p className="text-sm text-gray-400 px-3 py-2">{profile?.email}</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Timezone</label>
            <input
              value={editTimezone}
              onChange={(e) => setEditTimezone(e.target.value)}
              placeholder="e.g. Europe/Berlin"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
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

      {/* Invite Codes */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Invite Friends</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <button
            onClick={handleGenerateInvite}
            disabled={generatingInvite}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {generatingInvite ? "Generating..." : "Generate Invite Code"}
          </button>

          {profile?.inviteCodes && profile.inviteCodes.length > 0 && (
            <div className="space-y-2 pt-2">
              {profile.inviteCodes.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <div>
                    <span className="font-mono text-sm text-green-400 select-all">{c.code}</span>
                    {!c.used && (
                      <span className="ml-2 text-[10px] text-gray-500">
                        {typeof window !== "undefined" ? `${window.location.origin}/signup?code=${c.code}` : ""}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs ${c.used ? "text-gray-500" : "text-green-400"}`}>
                    {c.used ? `Used by ${c.usedByName || "someone"}` : "Available"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

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
          <span className="text-lg">&#x1F966;</span>
          <span className="font-semibold text-sm text-gray-300">Settings</span>
        </div>
        {/* Desktop: full */}
        <div className="hidden md:flex items-center justify-between py-3">
          <h1 className="text-2xl font-bold">Settings</h1>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">Dashboard</Link>
        </div>
      </div>

      <Suspense fallback={<div className="text-gray-500 text-center py-12">Loading...</div>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
