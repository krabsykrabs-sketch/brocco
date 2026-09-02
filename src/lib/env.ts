/**
 * Fail at boot, not per request. With SESSION_SECRET unset the container
 * used to start "healthy" and then throw inside every request. Called once
 * from instrumentation.ts.
 */
const REQUIRED = ["DATABASE_URL", "SESSION_SECRET", "BASE_URL", "ANTHROPIC_API_KEY"] as const;

const RECOMMENDED: Array<[string, string]> = [
  ["TOKEN_ENCRYPTION_KEY", "Strava/intervals tokens are encrypted with SESSION_SECRET instead; set this BEFORE ever rotating SESSION_SECRET"],
  ["STRAVA_WEBHOOK_SUBSCRIPTION_ID", "webhook events are NOT authenticated — run scripts/register-strava-webhook.ts and set the printed id"],
  ["SIGNUP_ACCESS_CODE", "signup is using the default code from the repo"],
];

export function assertEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  for (const [key, why] of RECOMMENDED) {
    if (!process.env[key]) console.warn(`[env] ${key} is not set — ${why}`);
  }
}
