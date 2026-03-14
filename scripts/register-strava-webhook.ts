import "dotenv/config";

const STRAVA_API = "https://www.strava.com/api/v3/push_subscriptions";

const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
const callbackUrl = `${process.env.BASE_URL}/api/strava/webhook`;

if (!clientId || !clientSecret || !verifyToken) {
  console.error("Missing required env vars: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN");
  process.exit(1);
}

async function listSubscriptions() {
  const res = await fetch(`${STRAVA_API}?client_id=${clientId}&client_secret=${clientSecret}`);
  return res.json();
}

async function createSubscription() {
  console.log(`Registering webhook: ${callbackUrl}`);

  const body = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    callback_url: callbackUrl,
    verify_token: verifyToken!,
  });

  const res = await fetch(STRAVA_API, {
    method: "POST",
    body,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Failed to register webhook:", data);
    process.exit(1);
  }

  console.log("Webhook registered:", data);
}

async function main() {
  // Check for existing subscriptions
  const existing = await listSubscriptions();

  if (Array.isArray(existing) && existing.length > 0) {
    console.log("Existing subscription(s) found:");
    console.log(JSON.stringify(existing, null, 2));
    console.log("\nStrava only allows one subscription per app. Delete the existing one first if you want to re-register.");
    return;
  }

  await createSubscription();
}

main();
