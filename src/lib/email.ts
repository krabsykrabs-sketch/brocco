/**
 * Outbound email via the Resend HTTP API (https://resend.com — free tier is
 * plenty for an invite-only app). Requires:
 *   RESEND_API_KEY  — API key from the Resend dashboard
 *   EMAIL_FROM      — verified sender, e.g. "Brocco <no-reply@brocco.run>"
 *                     (brocco.run must be verified as a domain in Resend)
 *
 * Behavior without a key:
 *   - development: the email content is logged to the console so flows can
 *     be tested end-to-end locally
 *   - production: sending fails closed (returns false, nothing logged that
 *     could leak a reset link into deploy logs)
 */

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail({ to, subject, text }: EmailPayload): Promise<boolean> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[email:dev-fallback] To: ${to}\nSubject: ${subject}\n${text}`);
      return true;
    }
    console.warn("[email] RESEND_API_KEY/EMAIL_FROM not configured — email not sent");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed:", err);
    return false;
  }
}

export function passwordResetEmail(resetUrl: string): { subject: string; text: string } {
  return {
    subject: "Reset your brocco.run password",
    text: `Hey,

someone (hopefully you) asked to reset the password for your brocco.run account.

Reset it here (the link is valid for 1 hour):
${resetUrl}

If you didn't request this, you can ignore this email — your password stays unchanged.

🥦 Brocco`,
  };
}
