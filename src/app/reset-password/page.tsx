"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/app/features-provider";

function ResetPasswordForm() {
  const t = useT();
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
      setError(t("auth.passwordsMismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.minChars"));
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
        setError(data.error || t("auth.resetFailed"));
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError(t("common.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold mb-4">{t("auth.resetLinkIncomplete")}</p>
        <a href="/forgot-password" className="text-leaf font-bold underline text-sm">
          {t("auth.requestNewLink")}
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-sprout border-2 border-ink rounded-xl p-4 text-sm text-ink font-bold text-center">
        {t("auth.passwordUpdated")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-bold text-ink mb-1">
          {t("auth.newPassword")}
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          className="field"
          placeholder={t("auth.minChars")}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-bold text-ink mb-1">
          {t("auth.repeatNewPassword")}
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="field"
          placeholder={t("auth.sameAgain")}
        />
      </div>

      {error && <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="btn-brocco w-full py-2 px-4"
      >
        {loading ? t("common.saving") : t("auth.setNewPassword")}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useT();
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm sticker-lg p-6">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt={t("auth.mascotAlt")} className="h-32 mx-auto mb-4" />
          <h1 className="text-2xl font-extrabold text-ink">{t("auth.chooseNewPassword")}</h1>
        </div>
        <Suspense fallback={<div className="text-moss text-center">{t("common.loading")}</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
