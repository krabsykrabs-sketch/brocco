"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

interface ProfileData {
  name: string;
  email: string;
  stravaConnected: boolean;
  stravaAthleteId: string | null;
  timezone: string;
  goalRace: string | null;
  goalTime: string | null;
  goalRaceDate: string | null;
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stravaStatus = searchParams.get("strava");

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`Imported ${data.activitiesImported} activities`);
      } else {
        setSyncResult(data.error || "Sync failed");
      }
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
      if (res.ok) {
        setInviteCode(data.code);
      }
    } catch {
      // ignore
    } finally {
      setGeneratingInvite(false);
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
          Strava connected successfully. Your activities are being imported.
        </div>
      )}
      {stravaStatus === "denied" && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-sm text-yellow-300">
          Strava authorization was denied.
        </div>
      )}
      {stravaStatus === "error" && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          Failed to connect Strava. Please try again.
        </div>
      )}

      {/* Profile */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Name</span>
            <span className="text-sm">{profile?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Email</span>
            <span className="text-sm">{profile?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400 text-sm">Timezone</span>
            <span className="text-sm">{profile?.timezone}</span>
          </div>
          {profile?.goalRace && (
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Goal</span>
              <span className="text-sm">
                {profile.goalRace}
                {profile.goalTime && ` (${profile.goalTime})`}
              </span>
            </div>
          )}
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
                  Connected (Athlete ID: {profile.stravaAthleteId})
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {syncing ? "Syncing..." : "Sync Activities"}
                </button>
              </div>
              {syncResult && (
                <p className="text-sm text-gray-400">{syncResult}</p>
              )}
              <p className="text-xs text-gray-600">
                Powered by Strava
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Connect your Strava account to automatically import activities.
              </p>
              <a
                href="/api/strava/auth"
                className="inline-block px-4 py-2 text-sm bg-[#FC4C02] hover:bg-[#e04400] text-white font-medium rounded-lg transition-colors"
              >
                Connect Strava
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Invite Codes */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Invite Friends</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-400">
            Generate an invite code for a friend to join brocco.run.
          </p>
          <button
            onClick={handleGenerateInvite}
            disabled={generatingInvite}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {generatingInvite ? "Generating..." : "Generate Invite Code"}
          </button>
          {inviteCode && (
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Share this code:</p>
              <p className="font-mono text-green-400 text-lg select-all">{inviteCode}</p>
              <p className="text-xs text-gray-500 mt-1">
                Or share the link: {typeof window !== "undefined" ? window.location.origin : ""}/signup?code={inviteCode}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Logout */}
      <section>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-400 hover:text-red-400 transition-colors"
        >
          Log out
        </button>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="min-h-screen max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Link
          href="/"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Dashboard
        </Link>
      </div>

      <Suspense fallback={<div className="text-gray-500 text-center py-12">Loading...</div>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
