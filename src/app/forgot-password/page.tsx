"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm sticker-lg p-6">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt="Brocco, running" className="h-32 mx-auto mb-4" />
          <h1 className="text-2xl font-extrabold text-ink">Reset password</h1>
          <p className="text-moss text-sm mt-1">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div className="bg-sprout border-2 border-ink rounded-xl p-4 text-sm text-ink font-bold text-center">
            If that address has an account, a reset link is on its way. Check your inbox
            (and the spam folder).
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-bold text-ink mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="field"
                placeholder="you@example.com"
              />
            </div>

            {error && <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-brocco w-full py-2 px-4"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="text-center text-moss text-sm mt-6">
          <a href="/login" className="text-leaf font-bold underline">
            Back to login
          </a>
        </p>
      </div>
    </main>
  );
}
