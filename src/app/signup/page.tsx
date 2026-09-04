"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useT } from "@/app/features-provider";

function SignupForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessCode, setAccessCode] = useState(searchParams.get("code") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, accessCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("auth.signupFailed"));
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="access-code" className="block text-sm font-bold text-ink mb-1">
          {t("auth.accessCode")}
        </label>
        <input
          id="access-code"
          type="text"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
          required
          className="field"
          placeholder={t("auth.accessCodePlaceholder")}
        />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-bold text-ink mb-1">
          {t("settings.name")}
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="field"
          placeholder={t("auth.namePlaceholder")}
        />
      </div>

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
          minLength={8}
          className="field"
          placeholder={t("auth.newPasswordPlaceholder")}
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
        {loading ? t("auth.creatingAccount") : t("auth.signup")}
      </button>
    </form>
  );
}

export default function SignupPage() {
  const t = useT();
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm sticker-lg p-6">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt={t("auth.mascotAlt")} className="h-32 mx-auto mb-4" />
          <h1 className="text-2xl font-extrabold text-ink">{t("auth.joinTitle")}</h1>
          <p className="text-moss text-sm mt-1">{t("auth.inviteNeeded")}</p>
        </div>

        <Suspense fallback={<div className="text-moss text-center">{t("common.loading")}</div>}>
          <SignupForm />
        </Suspense>

        <p className="text-center text-moss text-sm mt-6">
          {t("auth.alreadyHaveAccount")}{" "}
          <a href="/login" className="text-leaf font-bold underline">
            {t("auth.login")}
          </a>
        </p>
      </div>
    </main>
  );
}
