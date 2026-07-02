/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Hosts the in-process reminder scheduler (this app is a single long-running
 * container, so an interval here is the whole "cron" story).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderScheduler } = await import("@/lib/reminder-push");
    startReminderScheduler();
  }
}
