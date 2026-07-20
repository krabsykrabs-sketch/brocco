import Link from "next/link";

export default function LegalPage() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-24">
      <nav className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-8 border-b-2 border-ink/10">
        <div className="hidden md:flex items-center justify-between pb-6">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-64.png" alt="Brocco" className="w-8 h-8 rounded-full border-2 border-ink" />
            <span className="font-extrabold text-lg text-ink">brocco.run</span>
          </Link>
          <Link href="/" className="text-sm text-moss hover:text-ink transition-colors">Back</Link>
        </div>
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
          <span className="font-bold text-sm text-ink">Legal</span>
        </div>
      </nav>

      <h1 className="text-2xl font-extrabold mb-8">Legal</h1>

      {/* Imprint */}
      <section className="mb-10">
        <h2 className="text-lg font-bold mb-4 text-ink">
          Imprint (Impressum)
        </h2>
        <div className="sticker p-5 space-y-2 text-sm text-ink">
          <p>
            <span className="text-moss">Name:</span> Jan Ahrens
          </p>
          <p>
            <span className="text-moss">Email:</span>{" "}
            <a
              href="mailto:krabsykrabs@gmail.com"
              className="text-leaf font-bold hover:underline"
            >
              krabsykrabs@gmail.com
            </a>
          </p>
          <p className="text-moss text-xs pt-1">
            This is a non-commercial, personal project.
          </p>
        </div>
      </section>

      {/* Privacy Policy */}
      <section>
        <h2 className="text-lg font-bold mb-4 text-ink">
          Privacy Policy
        </h2>
        <div className="sticker p-5 space-y-4 text-sm text-ink leading-relaxed">
          <div>
            <h3 className="text-ink font-bold mb-1">
              What we store
            </h3>
            <ul className="list-disc list-inside space-y-1 text-moss">
              <li>
                Your email, name, and password hash for authentication
              </li>
              <li>
                If you connect Strava: your activity data (distance, pace,
                heart rate, splits, etc.) and OAuth tokens (encrypted at
                rest)
              </li>
              <li>
                Chat messages and coaching notes from your conversations
                with Brocco
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">
              How we use it
            </h3>
            <p className="text-moss">
              Your data is used solely to provide personalized coaching
              advice. We use the Anthropic API (Claude) to generate
              coaching responses &mdash; your training context is sent to
              their API with each chat message.
            </p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">
              What we don&apos;t do
            </h3>
            <p className="text-moss">
              We do not sell, share, or use your data for advertising.
              Period.
            </p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">
              Strava data
            </h3>
            <p className="text-moss">
              Strava data is handled per the{" "}
              <a
                href="https://www.strava.com/legal/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FC4C02] font-bold hover:underline"
              >
                Strava API Agreement
              </a>
              .
            </p>
          </div>

          <div>
            <h3 className="text-ink font-bold mb-1">
              Deleting your data
            </h3>
            <p className="text-moss">
              You can delete your account and all associated data by
              contacting{" "}
              <a
                href="mailto:krabsykrabs@gmail.com"
                className="text-leaf font-bold hover:underline"
              >
                krabsykrabs@gmail.com
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
