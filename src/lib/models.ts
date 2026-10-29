/**
 * Every Anthropic model id the app uses, in one place.
 *
 * These were previously hard-coded at nine call sites and had already drifted:
 * the coach — the part doing all the tool calling — sat two generations behind
 * the model used for recipe scanning. Upgrading now means editing this file.
 */

/**
 * The coach itself: chat, voice capture, the daily opener and briefing, the
 * weekly review, and generating the next week's detail. Everything here is
 * either user-facing conversation or tool-calling.
 *
 * Sonnet, not Opus, for cost: at three active users the coach was ~$75/month
 * on Opus 5. Must be Sonnet 5.5 or later, not Sonnet 5 — the chat route sends
 * a mid-conversation `role: "system"` message, which Sonnet 5 rejects.
 */
export const COACH_MODEL = "claude-sonnet-5-5";

/**
 * Structured extraction with a narrow, well-specified output — building a
 * guided workout, reading a recipe off a photo. No plan mutations, no
 * conversation.
 */
export const UTILITY_MODEL = "claude-sonnet-5";
