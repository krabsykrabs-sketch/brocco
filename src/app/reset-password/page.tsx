"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Minimum 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Reset failed");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold mb-4">This reset link is incomplete.</p>
        <a href="/forgot-password" className="text-leaf font-bold underline text-sm">
          Request a new one
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-sprout border-2 border-ink rounded-xl p-4 text-sm text-ink font-bold text-center">
        Password updated. Taking you to the login…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-bold text-ink mb-1">
          New password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          className="field"
          placeholder="Minimum 8 characters"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-bold text-ink mb-1">
          Repeat new password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="field"
          placeholder="Same again"
        />
      </div>

      {error && <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="btn-brocco w-full py-2 px-4"
      >
        {loading ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm sticker-lg p-6">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt="Brocco, running" className="h-32 mx-auto mb-4" />
          <h1 className="text-2xl font-extrabold text-ink">Choose a new password</h1>
        </div>
        <Suspense fallback={<div className="text-moss text-center">Loading…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
