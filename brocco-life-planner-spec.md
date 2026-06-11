# Brocco Life Planner — Expansion Spec

**For: Claude Code (Fable 5) implementation session**
**Read `CLAUDE-ai-coach.md` and `ai-running-coach-concept.md` first — they describe the existing app.**

## What this is

brocco.run is currently an AI running coach: Strava integration, training plans, chat coaching with Brocco 🥦 (Claude Opus via Anthropic API). This spec expands it into a **voice-first life planner** — calendar, tasks, notes, daily briefings — with running coaching becoming one feature among several, all driven by the same single Brocco assistant.

You have a lot of freedom in implementation details, component design, and UX polish. The vision, constraints, and must-have behaviors below are fixed. Where this doc is silent, use your judgment and follow the existing codebase conventions.

## Hard constraints

1. **Do not break existing training plans.** There are real users with active plans. The expansion is additive: new tables, new pages, extended system prompt. Existing tables (plans, plan_weeks, planned_workouts, activities, health_log, chat_sessions, chat_messages, user_profiles) keep working. All migrations must be backwards-compatible — no destructive changes to existing columns or data. Test that existing dashboards, plan pages, and chat history still work after migration.
2. **One assistant.** Brocco handles everything — training, calendar, tasks, notes. No second bot, no mode switching the user has to think about. Brocco's personality stays (coach first, broccoli second), but it now also manages your life admin without forcing vegetable jokes into it.
3. **No external calendar sync** (Google/Apple) in this phase. Don't design it in, but don't make it impossible later.
4. **Voice-first, everywhere.** Voice input is not a chat feature — it's the primary input method of the whole app. Typing always remains available.
5. **Keep the existing stack**: Next.js 15 App Router, TypeScript, Tailwind, PostgreSQL + Prisma, Anthropic API (Opus, streaming, tool use), Groq Whisper for voice, iron-session, deployed on Coolify. PWA with bottom tab bar on mobile.

## Interaction model

Three modes, in order of expected frequency:

1. **Quick capture (~90% of usage):** A floating mic button is visible on every screen. The user speaks ("dentist Thursday 3pm", "remind me to renew my passport", "groceries: milk, eggs, coffee"). The utterance is transcribed (Groq Whisper), sent to Brocco with the current screen as context, Brocco executes the right tool call, and the UI updates in place with a brief confirmation toast ("✓ Dentist — Thu 3pm"). No chat bubble, no navigation. The screen the user is looking at IS the feedback.
2. **Inline clarification:** If the request is ambiguous ("which Thursday — tomorrow or next week?"), show a small inline overlay with Brocco's one-line question. The user answers by voice or tap. Keep this lightweight — not a full chat takeover.
3. **Full chat:** The Chat tab, for planning sessions, analysis, reorganizing a week, training questions. Works as today, including the smart-trigger openers.

Quick captures should be logged into the chat history (so the conversation record stays complete and Brocco has context), but the user shouldn't be pulled into the chat UI for them.

**Screen context matters:** when the user dictates from the calendar view, pass which view and date range they're looking at. "Move that to 5" while looking at Thursday means something different than in a vacuum. Pass current screen + visible date range + selected item (if any) along with every quick-capture request.

## Navigation (mobile bottom tabs)

Replace the current tabs (Home, Chat, Plan, History, Settings) with:

**Today · Calendar · Chat · Tasks · More**

- **Today** — the new home screen and default tab (see below)
- **Calendar** — day/week/month views; week view is the default on mobile
- **Chat** — existing chat, unchanged behavior
- **Tasks** — task lists and Today's due items
- **More** — submenu containing: Training Plan (existing /plan), History (existing /history), Settings (existing /settings)

The training-related pages move under More but are otherwise untouched. Desktop top-nav mirrors this structure.

## Feature 1: Today view (new home screen)

A single daily agenda that merges everything:

- **Morning briefing header** — a short Brocco-generated summary at the top: "Today: standup at 10, dentist at 3, easy 5k planned. Passport renewal is due this week." Generated server-side with the same smart-trigger logic as the chat opener (new day or new activity → regenerate; otherwise cached). Reuse/extend the existing opener infrastructure rather than building a parallel one.
- **Chronological agenda** — calendar events, the planned workout (from the existing training plan, visually distinct, tappable through to plan detail), and due tasks, in one list.
- **Quick check-off** — tasks completable inline.
- The existing day-carousel dashboard is replaced by Today. Salvage anything useful (contextual comments, week summary card can move to the Calendar or Plan area at your discretion — your call whether the week summary lives on Today as a compact card).

## Feature 2: Calendar

- **Views:** day, week (default on mobile), month. Swipe navigation consistent with the existing plan-page week swiping (horizontal, peek edges, the polished animation pattern already built).
- **Events:** title, start/end (or all-day), optional location, optional notes, category with color (work, family, training, social, health, other — user-assignable, sensible defaults), optional recurrence (daily/weekly/monthly/yearly, with end date or count), optional reminder offset.
- **Training integration:** planned workouts from the active training plan appear automatically in the calendar as a distinct category. They are read-through views of planned_workouts — do NOT duplicate them into the events table. Editing/moving a workout goes through the existing plan logic (Brocco's adjust_plan), not generic event editing.
- **Recurring events:** store the rule, materialize occurrences at query time or via a sensible expansion strategy — your choice, but avoid writing thousands of rows.
- **Event creation:** voice-first (quick capture), plus a manual form (FAB or tap-on-slot) for typed entry.

## Feature 3: Tasks

- Tasks with: title, optional due date/time, optional priority (low/med/high), optional recurrence ("water plants every Sunday"), optional list/project assignment, optional subtasks, done state.
- **Lists/projects:** user-creatable (Groceries, House, Work...). A default Inbox for uncategorized capture.
- **Views:** Today (due today + overdue), Upcoming, and per-list. Overdue items roll forward visibly rather than disappearing.
- Recurring tasks regenerate on completion (next occurrence created when current is checked off).
- No AI time-blocking in this phase (don't auto-schedule tasks into calendar slots). Keep the door open.

## Feature 4: Notes & memory

- Quick facts and lists captured by voice: "my locker code is 4821", "packing list for Mallorca: ...".
- Simple structure: title + free text body + optional tags. Searchable.
- Brocco can store and retrieve these via tools. Generalize the pattern used for coaching_notes — but keep coaching_notes itself untouched for plan logic.

## Feature 5: Birthdays & important dates

- Lightweight: name + date + optional note, with advance reminders surfaced in the morning briefing ("Anna's birthday is in 3 days").
- Can be implemented as a special recurring event category if that's cleaner — your call.

## Brocco's new tools

Extend the existing tool set (adjust_plan, modify_plan, log_health, log_activity, query_data, save_profile) with life-planner tools. Suggested shape — refine as you see fit:

- `manage_event` — create/update/delete calendar events, including recurrence
- `manage_task` — create/update/complete/delete tasks and lists
- `manage_note` — create/update/search notes
- `query_schedule` — read calendar + tasks + workouts for a date range (so Brocco can answer "what does my Thursday look like" and detect conflicts)

Update the system prompt so Brocco:
- routes utterances to the right tool without the user naming the feature
- detects cross-domain conflicts and mentions them: "Your long run is Saturday but you have a flight at 7am — want me to move the run to Friday?" This cross-intelligence between calendar and training is the app's signature feature; make sure query_schedule gives Brocco what it needs for it.
- keeps the [STATUS:...] strip convention in full-chat responses; quick captures get toast confirmations instead.

## Quick capture pipeline (build this carefully)

`POST /api/capture`: accepts transcript (or text) + screen context → runs a Brocco tool-use loop (streaming, Opus, same infra as chat) → returns either `{ result: 'done', toast, mutations }` or `{ result: 'clarify', question }`. Persist the exchange into the day's chat session. Client updates the affected view optimistically/refetches. Aim for snappy: transcription + execution should feel ~2-3 seconds for simple captures.

## Database (suggested — adapt as needed)

New tables, all additive: `events` (with recurrence fields), `event_categories` (or enum + user color prefs), `tasks`, `task_lists`, `notes`, `important_dates` (if not folded into events). All scoped by user_id like everything else. Existing tables unchanged.

## Migration & rollout

1. Additive Prisma migrations only. Run against a copy of prod data first if feasible.
2. Existing routes keep working throughout (old dashboard can redirect to /today at the end).
3. Verify after migration: existing user logs in → plan intact, history intact, chat history intact, Strava sync works.
4. Update `CLAUDE-ai-coach.md` and `ai-running-coach-concept.md` at the end to reflect the new architecture.

## Out of scope (this phase)

External calendar sync, AI time-blocking, meal planning, finance tracking, shared/multi-user calendars, text-to-speech output, native push notifications (in-app reminder surfacing is fine; PWA push can come later).

## Definition of done

- New tab structure live; Today is the home screen with working morning briefing
- Calendar with day/week/month, recurring events, training plan visible inline
- Tasks with lists, recurrence, Today view
- Notes and birthdays capturable and retrievable by voice
- Floating mic quick-capture works on Today, Calendar, and Tasks screens with screen context
- Cross-domain conflict awareness demonstrated (workout vs. event)
- All existing training features work unchanged for existing users
- Docs updated
