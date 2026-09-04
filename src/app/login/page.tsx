"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/app/features-provider";

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("auth.loginFailed"));
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(t("common.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm sticker-lg p-6">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt={t("auth.mascotAlt")} className="h-36 mx-auto mb-4" />
          <h1 className="text-2xl font-extrabold text-ink">brocco.run</h1>
          <p className="text-moss text-sm mt-1">{t("auth.tagline")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-bold text-ink mb-1">
              {t("settings.email")}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="field"
              placeholder={t("auth.emailPlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-bold text-ink mb-1">
              {t("auth.password")}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="field"
              placeholder={t("auth.passwordPlaceholder")}
            />
          </div>

          {error && (
            <p className="bg-clay-soft border-2 border-clay text-clay rounded-xl px-3 py-2 text-sm font-bold">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-brocco w-full py-2 px-4"
          >
            {loading ? t("auth.loggingIn") : t("auth.login")}
          </button>
        </form>

        <p className="text-center mt-3">
          <a href="/forgot-password" className="text-sm text-moss hover:text-ink underline underline-offset-2">
            {t("auth.forgotPassword")}
          </a>
        </p>

        <p className="text-center text-moss text-sm mt-6">
          {t("auth.haveInvite")}{" "}
          <a href="/signup" className="text-leaf font-bold underline">
            {t("auth.signup")}
          </a>
        </p>
      </div>
    </main>
  );
}
