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
 * either user-facing conversation or tool-calling, which is where the strongest
 * model earns its keep.
 */
export const COACH_MODEL = "claude-opus-5";

/**
 * Structured extraction with a narrow, well-specified output — building a
 * guided workout, reading a recipe off a photo. No plan mutations, no
 * conversation.
 */
export const UTILITY_MODEL = "claude-sonnet-5";
