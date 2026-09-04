import Link from "next/link";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { translator } from "@/lib/dict";
import { isLang, langFromAcceptLanguage } from "@/lib/i18n";

const CONTACT_EMAIL = "krabsykrabs@gmail.com";

export default async function LegalPage() {
  // Reachable logged out (it is in the service worker's shell), so the session
  // is optional: a stored language choice wins when there is one, otherwise
  // the browser's Accept-Language stands in for the client-side detectLang().
  const session = await getSession();
  const profile = session.userId
    ? await prisma.userProfile.findUnique({ where: { userId: session.userId }, select: { language: true } })
    : null;
  const lang = isLang(profile?.language)
    ? profile.language
    : langFromAcceptLanguage((await headers()).get("accept-language"));
  const t = translator(lang);

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
      <nav className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-8 border-b-2 border-ink/10">
        <div className="hidden md:flex items-center justify-between pb-6">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-64.png" alt="Brocco" className="w-8 h-8 rounded-full border-2 border-ink" />
            <span className="font-extrabold text-lg text-ink">brocco.run</span>
          </Link>
          <Link href="/" className="text-sm text-moss hover:text-ink transition-colors">{t("legal.back")}</Link>
        </div>
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
          <span className="font-bold text-sm text-ink">{t("legal.title")}</span>
        </div>
      </nav>

      <h1 className="text-2xl font-extrabold mb-8">{t("legal.title")}</h1>

      {/* Imprint */}
      <section className="mb-10">
        <h2 className="text-lg font-bold mb-4 text-ink">{t("legal.imprintTitle")}</h2>
        <div className="sticker p-5 space-y-2 text-sm text-ink">
          <p>
            <span className="text-moss">{t("legal.nameLabel")}</span> Jan Ahrens
          </p>
          <p>
            <span className="text-moss">{t("legal.emailLabel")}</span>{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-leaf font-bold hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="text-moss text-xs pt-1">{t("legal.nonCommercial")}</p>
        </div>
      </section>

      {/* Privacy Policy */}
      <section>
        <h2 className="text-lg font-bold mb-4 text-ink">{t("legal.privacyTitle")}</h2>
        <div className="sticker p-5 space-y-4 text-sm text-ink leading-relaxed">
          <div>
            <h3 className="text-ink font-bold mb-1">{t("legal.storeTitle")}</h3>
            <ul className="list-disc list-inside space-y-1 text-moss">
              <li>{t("legal.storeAuth")}</li>
              <li>{t("legal.storeStrava")}</li>
              <li>{t("legal.storeChat")}</li>
            </ul>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">{t("legal.useTitle")}</h3>
            <p className="text-moss">{t("legal.useBody")}</p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">{t("legal.dontTitle")}</h3>
            <p className="text-moss">{t("legal.dontBody")}</p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">{t("legal.stravaTitle")}</h3>
            <p className="text-moss">
              {t("legal.stravaBefore")}{" "}
              <a
                href="https://www.strava.com/legal/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FC4C02] font-bold hover:underline"
              >
                {t("legal.stravaLink")}
              </a>
              {t("legal.stravaAfter")}
            </p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">{t("legal.deleteTitle")}</h3>
            <p className="text-moss">
              {t("legal.deleteBefore")}{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-leaf font-bold hover:underline">
                {CONTACT_EMAIL}
              </a>
              {t("legal.deleteAfter")}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
