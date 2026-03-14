import { prisma } from "@/lib/db";
import crypto from "crypto";

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth";

// Simple encryption for tokens at rest
const ALGO = "aes-256-cbc";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET!;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, getEncryptionKey(), iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptToken(encrypted: string): string {
  const [ivHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, getEncryptionKey(), iv);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Get a valid access token for a user, refreshing if expired.
 */
export async function getValidToken(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });

  if (!profile?.stravaAccessToken || !profile?.stravaRefreshToken) {
    throw new Error("User has no Strava tokens");
  }

  const accessToken = decryptToken(profile.stravaAccessToken);
  const refreshToken = decryptToken(profile.stravaRefreshToken);

  // Check if token is expired (with 5 min buffer)
  if (profile.stravaTokenExpiresAt && profile.stravaTokenExpiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return accessToken;
  }

  // Refresh the token
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status}`);
  }

  const data = await res.json();

  await prisma.userProfile.update({
    where: { userId },
    data: {
      stravaAccessToken: encryptToken(data.access_token),
      stravaRefreshToken: encryptToken(data.refresh_token),
      stravaTokenExpiresAt: new Date(data.expires_at * 1000),
    },
  });

  return data.access_token;
}

/**
 * Fetch a single activity from Strava by ID.
 */
export async function fetchStravaActivity(accessToken: string, activityId: string) {
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Strava activity fetch failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch a page of activities from Strava.
 */
export async function fetchStravaActivities(
  accessToken: string,
  page: number = 1,
  perPage: number = 200,
  after?: number
) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (after) params.set("after", String(after));

  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Strava activities fetch failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Compute pace in seconds per km from distance (meters) and moving time (seconds).
 */
function computePace(distanceMeters: number, movingTimeSeconds: number): { display: string; seconds: number } | null {
  if (!distanceMeters || distanceMeters < 100) return null;
  const distanceKm = distanceMeters / 1000;
  const paceSeconds = Math.round(movingTimeSeconds / distanceKm);
  const mins = Math.floor(paceSeconds / 60);
  const secs = paceSeconds % 60;
  return {
    display: `${mins}:${secs.toString().padStart(2, "0")}/km`,
    seconds: paceSeconds,
  };
}

/**
 * Convert a Strava activity to our DB shape and upsert it.
 */
export async function storeStravaActivity(userId: string, stravaActivity: Record<string, unknown>, timezone: string) {
  const activity = stravaActivity as {
    id: number;
    name: string;
    type: string;
    sport_type: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
    average_heartrate: number | null;
    max_heartrate: number | null;
    total_elevation_gain: number;
    average_cadence: number | null;
    calories: number | null;
    perceived_exertion: number | null;
    start_date: string;
    start_date_local: string;
    splits_metric: unknown[] | null;
  };

  const stravaId = String(activity.id);
  const distanceKm = activity.distance ? parseFloat((activity.distance / 1000).toFixed(2)) : null;
  const durationMin = parseFloat((activity.elapsed_time / 60).toFixed(2));
  const movingTimeMin = activity.moving_time ? parseFloat((activity.moving_time / 60).toFixed(2)) : null;
  const pace = activity.distance && activity.moving_time
    ? computePace(activity.distance, activity.moving_time)
    : null;

  // Use Strava's start_date_local which is in the athlete's local timezone
  const startDate = new Date(activity.start_date);
  const startDateLocal = new Date(activity.start_date_local);

  const data = {
    userId,
    source: "strava" as const,
    stravaId,
    name: activity.name,
    activityType: activity.sport_type || activity.type || "Run",
    distanceKm,
    durationMin,
    movingTimeMin,
    avgPacePerKm: pace?.display ?? null,
    paceSecondsPerKm: pace?.seconds ?? null,
    avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    elevationGainM: activity.total_elevation_gain ?? null,
    avgCadence: activity.average_cadence ? Math.round(activity.average_cadence) : null,
    calories: activity.calories ? Math.round(activity.calories) : null,
    perceivedEffort: activity.perceived_exertion ? Math.round(activity.perceived_exertion) : null,
    startDate,
    startDateLocal,
    splits: activity.splits_metric ? (activity.splits_metric as object) : undefined,
    rawData: stravaActivity as object,
  };

  // Upsert by stravaId for deduplication
  const result = await prisma.activity.upsert({
    where: { stravaId },
    update: {
      name: data.name,
      activityType: data.activityType,
      distanceKm: data.distanceKm,
      durationMin: data.durationMin,
      movingTimeMin: data.movingTimeMin,
      avgPacePerKm: data.avgPacePerKm,
      paceSecondsPerKm: data.paceSecondsPerKm,
      avgHeartRate: data.avgHeartRate,
      maxHeartRate: data.maxHeartRate,
      elevationGainM: data.elevationGainM,
      avgCadence: data.avgCadence,
      calories: data.calories,
      perceivedEffort: data.perceivedEffort,
      startDate: data.startDate,
      startDateLocal: data.startDateLocal,
      splits: data.splits,
      rawData: data.rawData,
    },
    create: data,
  });

  return result;
}

/**
 * Historical backfill: fetch the last 6 months of activities for a user.
 */
export async function backfillActivities(userId: string): Promise<number> {
  const token = await getValidToken(userId);
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const timezone = profile?.timezone || "Europe/Berlin";

  const sixMonthsAgo = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 60 * 60;
  let page = 1;
  let totalStored = 0;

  while (true) {
    const activities = await fetchStravaActivities(token, page, 200, sixMonthsAgo);

    if (!activities || activities.length === 0) break;

    for (const activity of activities) {
      try {
        await storeStravaActivity(userId, activity, timezone);
        totalStored++;
      } catch (err) {
        // Skip duplicates or errors, continue with next
        console.error(`Failed to store activity ${activity.id}:`, err);
      }
    }

    if (activities.length < 200) break;
    page++;
  }

  return totalStored;
}

/**
 * Build the Strava OAuth authorization URL.
 */
export function getStravaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${process.env.BASE_URL}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state,
  });
  return `${STRAVA_OAUTH}/authorize?${params}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeStravaCode(code: string) {
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava code exchange failed: ${res.status}`);
  }

  return res.json();
}
