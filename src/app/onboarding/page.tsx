"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const TOTAL_STEPS = 4;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < current ? "bg-green-500" : i === current ? "bg-green-400" : "bg-gray-700"
          }`}
        />
      ))}
    </div>
  );
}

function StepProfile({
  name,
  setName,
  yearsRunning,
  setYearsRunning,
  weeklyKm,
  setWeeklyKm,
  onNext,
}: {
  name: string;
  setName: (v: string) => void;
  yearsRunning: string;
  setYearsRunning: (v: string) => void;
  weeklyKm: string;
  setWeeklyKm: (v: string) => void;
  onNext: () => void;
}) {
  const canContinue = name.trim().length > 0;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">About you</h2>
      <p className="text-gray-400 text-sm mb-6">
        Tell Brocco a bit about your running background.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="What should Brocco call you?"
          />
        </div>

        <div>
          <label htmlFor="years" className="block text-sm font-medium text-gray-300 mb-1">
            Years running
          </label>
          <input
            id="years"
            type="number"
            min="0"
            max="60"
            value={yearsRunning}
            onChange={(e) => setYearsRunning(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="0"
          />
        </div>

        <div>
          <label htmlFor="km" className="block text-sm font-medium text-gray-300 mb-1">
            Typical weekly km
          </label>
          <input
            id="km"
            type="number"
            min="0"
            max="300"
            step="5"
            value={weeklyKm}
            onChange={(e) => setWeeklyKm(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="e.g. 30"
          />
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!canContinue}
        className="w-full mt-6 py-2.5 px-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        Continue
      </button>
    </div>
  );
}

function StepGoal({
  goalRace,
  setGoalRace,
  goalRaceDate,
  setGoalRaceDate,
  goalTime,
  setGoalTime,
  onNext,
  onBack,
}: {
  goalRace: string;
  setGoalRace: (v: string) => void;
  goalRaceDate: string;
  setGoalRaceDate: (v: string) => void;
  goalTime: string;
  setGoalTime: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Your goal</h2>
      <p className="text-gray-400 text-sm mb-6">
        Training for a race? Tell Brocco your target. Skip if you&apos;re just running for fun.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="race" className="block text-sm font-medium text-gray-300 mb-1">
            Race name
          </label>
          <input
            id="race"
            type="text"
            value={goalRace}
            onChange={(e) => setGoalRace(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="e.g. Barcelona Marathon 2026"
          />
        </div>

        <div>
          <label htmlFor="date" className="block text-sm font-medium text-gray-300 mb-1">
            Race date
          </label>
          <input
            id="date"
            type="date"
            value={goalRaceDate}
            onChange={(e) => setGoalRaceDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="time" className="block text-sm font-medium text-gray-300 mb-1">
            Target time
          </label>
          <input
            id="time"
            type="text"
            value={goalTime}
            onChange={(e) => setGoalTime(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="e.g. Sub 3:30"
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 px-4 border border-gray-700 text-gray-300 hover:bg-gray-800 font-medium rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
        >
          {goalRace ? "Continue" : "Skip"}
        </button>
      </div>
    </div>
  );
}

function StepTimezone({
  timezone,
  setTimezone,
  onNext,
  onBack,
}: {
  timezone: string;
  setTimezone: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDetected(tz);
    if (!timezone) {
      setTimezone(tz);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Timezone</h2>
      <p className="text-gray-400 text-sm mb-6">
        Brocco needs this to match your activities to your training plan correctly.
      </p>

      <div className="space-y-4">
        {detected && (
          <div className="text-sm text-gray-400">
            Detected: <span className="text-gray-200">{detected}</span>
          </div>
        )}

        <div>
          <label htmlFor="tz" className="block text-sm font-medium text-gray-300 mb-1">
            Your timezone
          </label>
          <input
            id="tz"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="Europe/Berlin"
          />
          <p className="text-xs text-gray-500 mt-1">
            IANA format, e.g. Europe/Berlin, America/New_York
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 px-4 border border-gray-700 text-gray-300 hover:bg-gray-800 font-medium rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!timezone}
          className="flex-1 py-2.5 px-4 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function StepWelcome({
  name,
  onFinish,
  loading,
  onBack,
}: {
  name: string;
  onFinish: () => void;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="text-center">
      <p className="text-7xl mb-4">&#x1F966;</p>
      <h2 className="text-2xl font-bold mb-2">
        Hey {name || "there"}, I&apos;m Brocco.
      </h2>
      <p className="text-gray-400 mb-6 leading-relaxed">
        Your personal running coach. I&apos;m a broccoli with an exercise physiology degree and
        an aggressively healthy outlook on life. I&apos;ll track your training, adjust your plan,
        and keep you on course for your goals.
      </p>
      <p className="text-gray-500 text-sm mb-8">
        You can connect Strava later in Settings to auto-import your activities.
        For now, let&apos;s get started.
      </p>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 px-4 border border-gray-700 text-gray-300 hover:bg-gray-800 font-medium rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={onFinish}
          disabled={loading}
          className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Setting up..." : "Let's go"}
        </button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Profile
  const [name, setName] = useState("");
  const [yearsRunning, setYearsRunning] = useState("");
  const [weeklyKm, setWeeklyKm] = useState("");

  // Goal
  const [goalRace, setGoalRace] = useState("");
  const [goalRaceDate, setGoalRaceDate] = useState("");
  const [goalTime, setGoalTime] = useState("");

  // Timezone
  const [timezone, setTimezone] = useState("");

  // Load existing profile data on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/onboarding");
        if (!res.ok) return;
        const data = await res.json();
        if (data.onboardingCompleted) {
          router.push("/");
          return;
        }
        if (data.name) setName(data.name);
        if (data.yearsRunning != null) setYearsRunning(String(data.yearsRunning));
        if (data.weeklyKmBaseline != null) setWeeklyKm(String(data.weeklyKmBaseline));
        if (data.goalRace) setGoalRace(data.goalRace);
        if (data.goalRaceDate) setGoalRaceDate(data.goalRaceDate.split("T")[0]);
        if (data.goalTime) setGoalTime(data.goalTime);
        if (data.timezone) setTimezone(data.timezone);
      } catch {
        // ignore — defaults are fine
      }
    }
    load();
  }, [router]);

  async function handleFinish() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          yearsRunning: yearsRunning ? parseInt(yearsRunning) : null,
          weeklyKmBaseline: weeklyKm ? parseFloat(weeklyKm) : null,
          goalRace: goalRace.trim() || null,
          goalRaceDate: goalRaceDate || null,
          goalTime: goalTime.trim() || null,
          timezone,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm py-12">
        <StepIndicator current={step} />

        {error && (
          <p className="text-red-400 text-sm mb-4 text-center">{error}</p>
        )}

        {step === 0 && (
          <StepProfile
            name={name}
            setName={setName}
            yearsRunning={yearsRunning}
            setYearsRunning={setYearsRunning}
            weeklyKm={weeklyKm}
            setWeeklyKm={setWeeklyKm}
            onNext={() => setStep(1)}
          />
        )}

        {step === 1 && (
          <StepGoal
            goalRace={goalRace}
            setGoalRace={setGoalRace}
            goalRaceDate={goalRaceDate}
            setGoalRaceDate={setGoalRaceDate}
            goalTime={goalTime}
            setGoalTime={setGoalTime}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}

        {step === 2 && (
          <StepTimezone
            timezone={timezone}
            setTimezone={setTimezone}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <StepWelcome
            name={name}
            onFinish={handleFinish}
            loading={loading}
            onBack={() => setStep(2)}
          />
        )}
      </div>
    </main>
  );
}
