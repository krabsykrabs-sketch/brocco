import Link from "next/link";

export default function LegalPage() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-8 pb-20">
      <nav className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm flex items-center justify-between py-3 -mx-4 px-4 mb-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">&#x1F966;</span>
          <span className="font-bold text-lg">brocco.run</span>
        </Link>
        <Link
          href="/"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Back to Dashboard
        </Link>
      </nav>

      <h1 className="text-2xl font-bold mb-8">Legal</h1>

      {/* Imprint */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4 text-gray-200">
          Imprint (Impressum)
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2 text-sm text-gray-300">
          <p>
            <span className="text-gray-500">Name:</span> Jan Ahrens
          </p>
          <p>
            <span className="text-gray-500">Email:</span>{" "}
            <a
              href="mailto:krabsykrabs@gmail.com"
              className="text-green-400 hover:underline"
            >
              krabsykrabs@gmail.com
            </a>
          </p>
          <p className="text-gray-500 text-xs pt-1">
            This is a non-commercial, personal project.
          </p>
        </div>
      </section>

      {/* Privacy Policy */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-gray-200">
          Privacy Policy
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4 text-sm text-gray-300 leading-relaxed">
          <div>
            <h3 className="text-gray-200 font-medium mb-1">
              What we store
            </h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
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
            <h3 className="text-gray-200 font-medium mb-1">
              How we use it
            </h3>
            <p className="text-gray-400">
              Your data is used solely to provide personalized coaching
              advice. We use the Anthropic API (Claude) to generate
              coaching responses &mdash; your training context is sent to
              their API with each chat message.
            </p>
          </div>

          <div>
            <h3 className="text-gray-200 font-medium mb-1">
              What we don&apos;t do
            </h3>
            <p className="text-gray-400">
              We do not sell, share, or use your data for advertising.
              Period.
            </p>
          </div>

          <div>
            <h3 className="text-gray-200 font-medium mb-1">
              Strava data
            </h3>
            <p className="text-gray-400">
              Strava data is handled per the{" "}
              <a
                href="https://www.strava.com/legal/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FC4C02] hover:underline"
              >
                Strava API Agreement
              </a>
              .
            </p>
          </div>

          <div>
            <h3 className="text-gray-200 font-medium mb-1">
              Deleting your data
            </h3>
            <p className="text-gray-400">
              You can delete your account and all associated data by
              contacting{" "}
              <a
                href="mailto:krabsykrabs@gmail.com"
                className="text-green-400 hover:underline"
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
