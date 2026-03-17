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

  // Upsert by userId+stravaId composite unique for deduplication
  // This allows multiple users to have the same Strava activity
  const result = await prisma.activity.upsert({
    where: {
      userId_stravaId: { userId, stravaId },
    },
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
 * Full historical backfill: fetch ALL activities (no date filter).
 */
export async function backfillActivitiesFull(userId: string): Promise<number> {
  const token = await getValidToken(userId);
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const timezone = profile?.timezone || "Europe/Berlin";

  let page = 1;
  let totalStored = 0;

  while (true) {
    const activities = await fetchStravaActivities(token, page, 200);

    if (!activities || activities.length === 0) break;

    for (const activity of activities) {
      try {
        await storeStravaActivity(userId, activity, timezone);
        totalStored++;
      } catch (err) {
        console.error(`Failed to store activity ${activity.id}:`, err);
      }
    }

    if (activities.length < 200) break;
    page++;
  }

  return totalStored;
}

/**
 * Analyze training history and build a summary for coaching_notes.
 * Extracts: race results, peak mileage blocks, monthly volume trend, inactivity gaps.
 */
export async function analyzeTrainingHistory(userId: string): Promise<Record<string, unknown>> {
  const activities = await prisma.activity.findMany({
    where: { userId, source: "strava" },
    orderBy: { startDateLocal: "asc" },
    select: {
      name: true,
      activityType: true,
      distanceKm: true,
      durationMin: true,
      startDateLocal: true,
      rawData: true,
    },
  });

  // 1. Race results — detect by workout_type or common race distances
  const raceDistances = [5, 10, 15, 21.1, 42.2]; // common race distances in km
  const races: Array<{ date: string; name: string; distance_km: number; time: string }> = [];

  for (const a of activities) {
    const raw = a.rawData as Record<string, unknown> | null;
    const isRace = raw?.workout_type === 1 || raw?.type === "Race"; // Strava race type
    const dist = a.distanceKm ? Number(a.distanceKm) : 0;
    const isRaceDistance = raceDistances.some((rd) => Math.abs(dist - rd) < rd * 0.05);

    if (isRace || (isRaceDistance && dist > 4)) {
      const durMin = Number(a.durationMin);
      const hours = Math.floor(durMin / 60);
      const mins = Math.floor(durMin % 60);
      const secs = Math.round((durMin % 1) * 60);
      const time = hours > 0
        ? `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
        : `${mins}:${secs.toString().padStart(2, "0")}`;

      races.push({
        date: a.startDateLocal.toISOString().slice(0, 7),
        name: a.name,
        distance_km: Math.round(dist * 10) / 10,
        time,
      });
    }
  }

  // 2. Monthly volume trend (running only)
  const runTypes = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
  const runs = activities.filter((a) => runTypes.includes(a.activityType));

  const monthlyKm: Record<string, { totalKm: number; weeks: Set<string> }> = {};
  for (const r of runs) {
    const month = r.startDateLocal.toISOString().slice(0, 7);
    const week = getISOWeek(r.startDateLocal);
    if (!monthlyKm[month]) monthlyKm[month] = { totalKm: 0, weeks: new Set() };
    monthlyKm[month].totalKm += r.distanceKm ? Number(r.distanceKm) : 0;
    monthlyKm[month].weeks.add(week);
  }

  const volumeTrend = Object.entries(monthlyKm)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      avg_weekly_km: data.weeks.size > 0
        ? Math.round((data.totalKm / data.weeks.size) * 10) / 10
        : 0,
    }));

  // 3. Peak 4-week mileage periods
  const weeklyKm: Array<{ week: string; km: number }> = [];
  const weekMap: Record<string, number> = {};
  for (const r of runs) {
    const week = getISOWeek(r.startDateLocal);
    weekMap[week] = (weekMap[week] || 0) + (r.distanceKm ? Number(r.distanceKm) : 0);
  }
  for (const [week, km] of Object.entries(weekMap)) {
    weeklyKm.push({ week, km });
  }
  weeklyKm.sort((a, b) => a.week.localeCompare(b.week));

  let peakMileage = { period: "", avg_weekly_km: 0 };
  for (let i = 0; i <= weeklyKm.length - 4; i++) {
    const slice = weeklyKm.slice(i, i + 4);
    const avg = slice.reduce((sum, w) => sum + w.km, 0) / 4;
    if (avg > peakMileage.avg_weekly_km) {
      peakMileage = {
        period: `${slice[0].week} to ${slice[3].week}`,
        avg_weekly_km: Math.round(avg * 10) / 10,
      };
    }
  }

  // 4. Inactivity gaps (>10 days with no activity)
  const inactivityGaps: Array<{ from: string; to: string; duration_days: number }> = [];
  for (let i = 1; i < activities.length; i++) {
    const prev = activities[i - 1].startDateLocal;
    const curr = activities[i].startDateLocal;
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 10) {
      inactivityGaps.push({
        from: prev.toISOString().slice(0, 10),
        to: curr.toISOString().slice(0, 10),
        duration_days: diffDays,
      });
    }
  }

  return {
    races,
    peak_mileage: peakMileage.avg_weekly_km > 0 ? peakMileage : null,
    volume_trend: volumeTrend,
    inactivity_gaps: inactivityGaps,
  };
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
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
