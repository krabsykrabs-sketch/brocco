import webpush from "web-push";
import { prisma } from "@/lib/db";

/**
 * Web Push sending. VAPID keys are self-generated (no external service):
 *   npx web-push generate-vapid-keys
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).
 */

let configured = false;

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

function ensureConfigured(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:no-reply@brocco.run",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // where a tap should take the user
  tag?: string; // replaces earlier notifications with the same tag
}

/**
 * Send a payload to every device the user has subscribed. Dead subscriptions
 * (endpoint gone: 404/410) are pruned automatically. Returns how many sends
 * were attempted and how many devices were pruned.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 }
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Device unsubscribed / endpoint expired — clean up
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        pruned++;
      } else {
        console.error(`[push] send failed (${statusCode ?? "?"}) for sub ${sub.id}:`, err);
      }
    }
  }

  return { sent, pruned };
}
