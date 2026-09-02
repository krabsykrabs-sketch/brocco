# CLAUDE.md — Brocco: AI Running Coach & Life Planner

## Project Overview

**brocco.run** — an AI training coach with a light life-planner around it, multi-user behind a shared signup code. Brocco 🥦 is the single assistant for everything: training plans (Strava-integrated), calendar and birthdays, guided strength sessions, and a recipe "kitchen". Voice input lives in the Chat tab (mic → Groq Whisper → text you can review and send); typing always works too.

**Slogan:** "Run like a broccoli."
**Deployment:** Coolify on Hetzner (EU), auto-deploy from GitHub main branch
**Reference:** See `ai-running-coach-concept.md` for the original coaching feature specs and `brocco-life-planner-spec.md` for the life-planner expansion spec (partly retired since — see the status note at the top of that file).

## Life Planner Architecture (June 2026 expansion, trimmed July 2026)

- **Navigation (mobile bottom tabs, `src/app/bottom-tabs.tsx`):** Today · Calendar · Chat · Plan · More when the calendar is enabled; with it disabled, Plan and History reclaim the slots (Today · Chat · Plan · History · More). `/` redirects to `/today`. More contains Training Plan (/plan), History, Workouts (/workout), Kitchen (/kitchen, if enabled), Settings. Desktop top-nav (shared `src/app/nav.tsx`) mirrors this.
- **Today (`/today`)** — home screen: Brocco-generated morning briefing (cached in `daily_briefings`, regenerated on new day / new synced activity — same smart-trigger idea as the chat opener; `GET /api/briefing`), today's agenda (events + planned workouts read-through, with Done/Skipped buttons for sessions the app can't detect on its own), weekly goals tracker, "coming up" strip, and the weekly review card (Sunday evening through Monday). The page also fires `POST /api/plan/promote` once per day per device (localStorage-gated); the promotion itself is a no-op until a week actually needs rolling.
- **Quick capture** — the floating-mic-on-every-screen pipeline described in the expansion spec was retired: the `QuickCapture` component and `POST /api/capture` are gone. The screen-context store (`src/lib/capture-context.ts`) survives because its `emitDataChanged` / `useDataChanged` helpers are how screens refetch after a change (`brocco:data-changed` window event). `buildSystemPrompt` still accepts a `"capture"` mode; nothing calls it.
- **Calendar (`/calendar`)** — day/week/month views (week default), swipe navigation, category colors (`src/lib/categories.ts`). Recurring events store a rule (`freq/interval/until/count` + `exdates` json) and are expanded at query time in `src/lib/schedule.ts` — never materialized as rows. Planned workouts appear read-through from `planned_workouts` (NOT duplicated into events; edits go through plan tools). Birthdays are events with `category=birthday`, all-day, yearly recurrence. A read-only ICS feed (`/api/calendar/ics?token=…`, token created in Settings via `POST /api/calendar/token`) lets phone calendars subscribe.
- **Tasks, Notes, Journal — retired (July 2026).** The pages, API routes, and Brocco tools (`manage_task`, `manage_note`) were removed. The DB models (`todos`, `task_lists`, `notes`, `journal_entries`) remain and nothing reads or writes them. `weekly_tasks` (per-plan-week checklist items, `add_weekly_tasks` tool, `/api/plan/tasks`) is a different thing and is still live.
- **Kitchen (`/kitchen`, feature-gated)** — recipe library (`recipes` table): manual entry, photo scan (`POST /api/recipes/scan`, Claude vision on the UTILITY model, photo discarded), pantry staples, and a dedicated kitchen chat (`chat_sessions.type = 'kitchen'`, `buildSystemPrompt(..., "kitchen")`). Brocco tool: `manage_recipe`.
- **Guided workouts (`/workout`)** — S&C sessions Brocco builds via the `create_workout` tool or `POST /api/guided-workouts/generate`, played in an in-app timer with voice cues and exercise diagrams. Completed sessions log a manual strength activity so they count toward the plan and weekly goals. Diagrams: `public/exercise-art/*.png` (103 today), registry in `src/lib/exercise-art.ts`, generated offline by `scripts/gen-exercise-art.ts` (Gemini image model, `GEMINI_API_KEY`) and committed — nothing is generated at runtime.
- **Weekly goals** — "do X three times this week" goals (`weekly_goals` + `weekly_goal_credits`), credited automatically from activities (`src/lib/weekly-goals.ts`), managed by Brocco via `manage_weekly_goals`, read by `GET /api/goals`.
- **Wall-time convention:** event timestamps are stored as the user's local wall-clock time in naive timestamps, read/written through UTC accessors (`parseWall`/`wallString` in `src/lib/schedule.ts`) so the server TZ never shifts them. "Today" is computed in the user's IANA timezone via `todayInTimezone`.
- **Cross-domain conflict awareness** is Brocco's signature feature: the system prompt includes a 7-day schedule block, and `query_schedule` returns the merged events+workouts view so Brocco flags collisions ("long run Saturday vs. 7am flight").
- **Feature toggles:** `user_profiles.features` jsonb ({calendar, kitchen}; null = all on; stale keys like `tasks`/`notes`/`journal` are ignored by `resolveFeatures`). Settings has switches; disabling adapts navigation, filters Brocco's tools/prompt/context per request (`toolsForFeatures` in tools.ts; `manage_event`/`query_schedule` need calendar, `manage_recipe` needs kitchen), empties disabled domains from /api/today and the briefing, and server-redirects /calendar and /kitchen to /today (`requireFeature` in lib/feature-guard.ts). Client side: FeaturesProvider (localStorage-cached, `brocco:features-changed` event) — it also carries the UI language.
- **Push reminders (shipped after the spec):** event reminders are sent as Web Push (`push_subscriptions`, VAPID keys) by an in-process scheduler started from `src/instrumentation.ts` (`src/lib/reminder-push.ts`, one tick per minute). `/api/push/*` manages subscriptions.
- **Language (en/de/es):** `user_profiles.language`, chosen in Settings, browser-detected on first run (`src/lib/i18n.ts`). UI strings come from `src/lib/dict.ts` via `useT()`; Brocco is told the language in its system prompt so everything it writes (chat, briefings, workout names) matches.
- **Primary sport:** `user_profiles.primarySport` (null = running). Any other sport switches the app to sessions/minutes instead of kilometres (`src/lib/sport.ts`), reshapes Brocco's persona, and changes what the plan promotion generates. Settings has the control.
- **Out of scope:** external calendar write-back (the ICS feed is read-only), AI time-blocking, TTS.

## Tech Stack

- **Framework:** Next.js 15 with App Router, TypeScript, Tailwind CSS
- **Database:** PostgreSQL (hosted on same Hetzner server via Coolify)
- **ORM:** Prisma
- **AI:** Anthropic API — model ids live in `src/lib/models.ts` (single source of truth): `COACH_MODEL = "claude-opus-5"` for everything conversational or tool-calling (chat, opener, briefing, weekly review, week promotion), `UTILITY_MODEL = "claude-sonnet-5"` for narrow structured extraction (recipe scan, guided-workout generation, conversation-memory summaries). Thinking is on by default on these models and shares `max_tokens`. Prompt caching: `buildSystemPrompt` returns `{staticPart, dynamicPart}`; the chat route sends `staticPart` as a system block with `cache_control: {type: "ephemeral", ttl: "1h"}`, puts a plain `cache_control` marker on the last user message, and appends `dynamicPart` (clock + live context) as a trailing `role: "system"` message so the cached history prefix is never invalidated. Cheap side calls use `output_config: { effort: "low" }`.
- **Strava:** OAuth2 + webhooks + REST API for activity data
- **Watch sync:** intervals.icu (`src/lib/intervals-icu.ts`) — planned workouts are pushed to the user's intervals.icu calendar, which forwards them to COROS/Garmin/Wahoo/Polar/Suunto
- **Voice Input:** Groq Whisper API (whisper-large-v3-turbo) — record in browser, transcribe server-side via Groq, free tier; live dictation feedback via the browser SpeechRecognition API (`src/lib/live-speech.ts`) where available
- **Email:** Resend (password reset only, `src/lib/email.ts`)
- **Push:** `web-push` with VAPID keys
- **Charts:** Recharts
- **Timezone:** date-fns-tz for all date comparisons and display
- **Auth:** Email + password (bcrypt), shared signup access code, iron-session cookies
- **Deployment:** Docker via Coolify, auto-deploy from GitHub. `docker-entrypoint.sh` runs `prisma migrate deploy` + the idempotent seed, then `node server.js`; the Dockerfile `HEALTHCHECK` hits `/api/health-check` (unauthenticated, checks the DB).

## Architecture Decisions

- **Multi-user behind a shared code** — email + password auth; signup requires the `SIGNUP_ACCESS_CODE` (default `brocco2026`), a bouncer for drive-by bots rather than a security boundary. No public signup page is linked anywhere. Every data table is scoped by `user_id`.
- **Strava is the primary data source** for activity data. Manual activities can be logged via AI chat (`log_activity`), by finishing a guided workout, or with the Done button on a planned session.
- **Two-tier plan changes** — Brocco auto-applies reactive micro-adjustments within the current week (distance/pace tweaks, moving a session to another day this week) with a log entry + undo. Structural changes (adding/deleting workouts, type changes, anything beyond 7 days out, phase/mileage target changes) require the user to confirm in chat first. See tool definitions for `adjust_plan` vs `modify_plan`.
- **Rolling planning horizon** — Brocco only generates detailed workouts for the current week + next week. Weeks 3-4 get an outline (types + volume). Week 5+ get phase-level targets only. Promotion (`src/lib/promote-weeks.ts`, `POST /api/plan/promote`, fired from the Today page once per day per device) rolls outline → detailed and target → outline. It takes a lease on the week (stale after 10 min) so two devices can't double-generate, merges instead of replacing (done/skipped/hand-adjusted/past rows are kept, and surviving `planned_workout` ids are carried through because timer sessions, adjustment logs and the watch calendar key on them), and generates in the user's primary sport and language. Changes and adjustments only touch the 2-week detail window — never regenerate the full plan.
- **Mobile-first design** — primary use case is checking the app on your phone after a run or asking the AI a question via voice.
- **Brocco is the coach** — the app has a single AI coach identity: Brocco 🥦, a broccoli with exercise physiology expertise. Personality is baked into the system prompt. No coach selection UI needed.
- **Context window strategy** — each AI call includes: profile, Brocco's personality, current plan (2 weeks), recent activities (14 days), training load (8 weeks), health notes, weekly goals, and the last few cross-day conversation summaries (`src/lib/conversation-memory.ts`). The AI can use `query_data` to fetch additional historical data on demand.
- **Numbers are checked, not trusted** — the opener and briefing are prose, not tool calls, so `src/lib/number-guard.ts` rejects any distance in the output that doesn't appear in the data block it was given.
- **Timezone-aware matching** — all date comparisons (activity-to-plan matching, dashboard rendering, plan display) use the user's configured timezone. Strava returns UTC; we store both UTC and local timestamps.

## Database

Prisma with PostgreSQL; the schema is `prisma/schema.prisma`, migrations are additive.

Key tables:
- `users` (auth: email, password_hash, session_epoch; `invite_code` is a legacy column — signup writes the literal `"access-code"`)
- `user_profiles` (one per user: goals, Strava tokens, timezone, coaching_notes, features, language, primary_sport, hr_max_bpm, ics_token, intervals.icu credentials, pantry staples, training equipment)
- `plans` (training plan metadata: name, goal, race_date, status — scoped by user_id)
- `plan_phases` (periodization phases within a plan: base, build, peak, taper)
- `plan_weeks` (week metadata: detail_level, target_km, target_sessions, session_types, notes — rolling horizon)
- `planned_workouts` (individual sessions: date, type, targets, structured steps, status, detail_level)
- `weekly_tasks` (flexible tasks per plan week without specific date: strength, mobility, nutrition, recovery. User can check off.)
- `weekly_goals` / `weekly_goal_credits` (per-user "N times this week" goals, auto-credited from activities)
- `activities` (unified table for Strava + manual: source field distinguishes origin)
- `health_log` (injuries, notes, race results: type, severity, status, body_part) — written by the `log_health` tool; there is no longer a CRUD API for it
- `chat_sessions` (conversation groupings — scoped by user_id; `type` is `general` or `kitchen`; the enum also still carries `onboarding` and `plan_creation`, which nothing creates)
- `chat_messages` (individual messages: role, content as jsonb, display_text, context_snapshot)
- `plan_adjustment_log` (auto-applied micro-adjustments with before/after state and undo support)
- `pending_plan_changes` (legacy — the model exists, nothing writes it; plan changes are confirmed in chat and applied directly)
- `invite_codes` (legacy — seeded for the creator, never checked at signup)
- `daily_briefings`, `weekly_reviews`, `password_reset_tokens`, `push_subscriptions`, `recipes`, `guided_workouts`, `guided_workout_sessions`
- `events` (title, location, notes, category enum incl. birthday, start_at/end_at as local wall time, all_day, recurrence freq/interval/until/count, `exdates` jsonb of removed occurrence dates, reminder_minutes)
- `task_lists`, `todos`, `notes`, `journal_entries` — retired features; tables kept, unused

Important details:
- **Every query must filter by `user_id`** — this is a multi-user app. Never return another user's data.
- `activities.strava_id` must be unique (when not null) — used for deduplication
- `activities.source` is either 'strava' or 'manual'
- `activities.start_date_local` stores the timestamp in the user's timezone — used for date matching
- `activities.pace_seconds_per_km` is an integer column for sorting/filtering (alongside the display string)
- `activities.raw_data` stores the full Strava API response. (No pruning job exists yet.)
- `activities.activity_analysis` — nullable jsonb. For eligible sessions, stores processed streams/laps data: HR zones, cardiac drift, pace fade, cadence, laps, power, pace curve, key insights (`src/lib/activity-analysis.ts`, `src/lib/heart-rate-analysis.ts`). See concept doc Phase 3 for the original spec.
- `planned_workouts.matched_activity_id` exists but is not written; completion is computed on read by `src/lib/plan-progress.ts` (a compatible-type activity on the same calendar day, whatever its source)
- `planned_workouts.status` enum: planned, completed, skipped, modified
- `user_profiles.strava_token_expires_at` is checked before every Strava API call
- `user_profiles.timezone` is required — default "Europe/Berlin"
- `user_profiles.coaching_notes` is jsonb — structured but flexible data Brocco gathers in chat via `save_profile` (injury history, preferences, race history, schedule constraints, nutrition, etc.). Included in every AI context.
- `user_profiles.onboarding_completed` is set to true at signup and read by nothing — there is no onboarding wizard.
- `health_log.status` can be 'active' or 'resolved' — active entries are included in AI context
- `chat_messages.content` is jsonb — stores the raw Anthropic API message content array (supports text + tool_use blocks)
- `chat_messages.display_text` is a text column with the human-readable version for UI rendering
- `plan_adjustment_log` stores every auto-applied micro-adjustment with `before_state`/`after_state` jsonb snapshots and an `undone` boolean.

## Key Patterns

### Auth & Signup Flow
1. `/login` page: email + password form → `POST /api/auth/login` (rate-limited per email and per IP).
2. `/signup?code=XXX` page: email, name, password, access code → `POST /api/auth/signup`. The code is compared (case-insensitively) against `SIGNUP_ACCESS_CODE`; 5 attempts per IP per hour. On success the user + profile rows are created and the session cookie is set. There is no per-user invite generation route.
3. Password reset: `/forgot-password` → `POST /api/auth/forgot` (always 200, sends a Resend email) → `/reset-password` → `POST /api/auth/reset`.
4. Session: iron-session cookie `brocco_session` (7 days), `src/lib/session.ts`. The cookie carries `userId`, `email`, and `epoch`; `getSession()` compares `epoch` with `users.session_epoch` on every request and destroys the session on mismatch. Password and email changes (`/api/auth/password`, `/api/auth/email`, both require the current password) bump the epoch, which logs out every other cookie.
5. Middleware (`src/middleware.ts`): unauthenticated requests get a JSON 401 for `/api/*` and a redirect to `/login` for pages. Public paths: `/login`, `/signup`, `/forgot-password`, `/reset-password`, everything under `/api/auth/`, `/api/strava/webhook`, `/api/calendar/ics`, `/api/features`, `/api/health-check`, plus static assets (`/brand/`, `/exercise-art/`, `/icons/`, PWA files).
6. Account deletion: `POST /api/auth/delete-account` (password-confirmed).
7. Required env vars are asserted once at boot in `src/lib/env.ts` (called from `src/instrumentation.ts`): `DATABASE_URL`, `SESSION_SECRET`, `BASE_URL`, `ANTHROPIC_API_KEY`. `TOKEN_ENCRYPTION_KEY`, `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and `SIGNUP_ACCESS_CODE` only warn when missing.

### Onboarding
There is no onboarding wizard. A new account lands on an empty-state Today screen with Strava-connect and build-a-plan CTAs; Brocco's system prompt knows whether Strava is connected and whether `coaching_notes` is empty, asks background questions naturally in chat, and stores what it learns with `save_profile`. Connecting Strava always runs the 6-month backfill (there is no "full history" option; `backfillActivitiesFull` / `analyzeTrainingHistory` exist in `src/lib/strava.ts` but nothing calls them).

### Plan Creation Interview (repeatable)
A conversation in the regular chat (no separate session type) for building a new training plan. Triggered by the user ("I want a new plan", or the New Plan button on /plan, which opens chat with a prefilled message), or proactively by Brocco when the current plan ends.

**Rules:**
- Only one active plan at a time. If active plan exists, Brocco warns and archives old plan when new one is confirmed.
- Supports race-specific goals (periodized: base → build → peak → taper), general fitness goals (progressive blocks with benchmarks, no taper), hybrid/Hyrox goals, and non-running primary sports. Brocco can suggest goals if user is unsure.
- New runners without Strava are asked to connect it before a plan is built.
- Brocco can convert an existing plan (e.g. to a new sport) without re-interviewing.

**Interview covers:** Goal type → target details → training philosophy (Brocco asks preference-revealing questions, selects best-fit approach: polarized/80-20, Jack Daniels, Pfitzinger, Norwegian, time-crunched — names and explains the choice) → current fitness assessment (references Strava + coaching_notes) → schedule for this block → preferences → known conflicts → rolling horizon plan generation (phase structure for full plan + detailed workouts for weeks 1-2 + outline for weeks 3-4 + targets for rest) via the `generate_plan` tool → user review and confirmation. Weeks are Monday–Sunday; a mid-week start gets a partial "Week 0".

**Plan lifecycle:**
- No plan → Today prompt encourages building one
- Active plan → race day passes → prompt + Brocco proactively suggests new plan
- Active plan → user requests new plan → confirmation → old plan archived → new plan active
- Active general plan → Brocco periodically checks in ("We're 12 weeks in. Want to keep going, set a race, or adjust?")

**`save_profile` tool:**
Brocco calls this during interviews and regular chat to save extracted data. Accepts both typed fields (name, goal_race, years_running, timezone, etc.) and a `coaching_notes_update` object that gets deep-merged into the existing `coaching_notes` jsonb. Called multiple times — partial saves are fine.

### Strava Integration Flow
1. User connects Strava via OAuth (one-time): `/api/strava/auth` → redirect to Strava → callback to `/api/strava/callback`
2. On callback: store tokens in user_profiles for this user (AES-encrypted with `TOKEN_ENCRYPTION_KEY`, falling back to `SESSION_SECRET` for older deployments — set the key BEFORE ever rotating the secret), then trigger the 6-month historical backfill and analyse eligible activities.
3. Webhook registration: one subscription per app (not per user), done by hand with `scripts/register-strava-webhook.ts`; put the printed id in `STRAVA_WEBHOOK_SUBSCRIPTION_ID`.
4. Webhook endpoint: `GET /api/strava/webhook` (hub.challenge verification against `STRAVA_WEBHOOK_VERIFY_TOKEN`), `POST /api/strava/webhook` (activity events)
5. On webhook event: reject unless `subscription_id` matches `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and `object_type` is "activity"; rate-limit 60 events/min per `owner_id`; look up the user by `owner_id` → `strava_athlete_id`. `delete` removes the stored activity; `create`/`update` fetch the full activity with that user's tokens, store it, and run activity analysis in the background. Plan matching is derived on read (`plan-progress.ts`); the webhook does not call Brocco.
6. Token refresh: before each API call for a specific user, check their `strava_token_expires_at`. If expired, refresh and update. A dead refresh token sets `strava_needs_reconnect` so Settings can prompt instead of runs silently stopping.
7. Other sync paths: `GET /api/strava/auto-sync` (once per local day on app open), `POST /api/strava/sync` (manual, 3/hour), and `src/lib/strava-fresh.ts` (incremental sync before the coach builds context if the last sync is older than 15 minutes). `POST /api/strava/disconnect` unlinks without deleting the account.

### AI Chat Flow
1. User sends message (text or transcribed speech)
2. Server ensures Strava is fresh, builds context (`buildCoachContext`) and the split system prompt (`buildSystemPrompt`), and filters tools by the user's feature toggles
3. Server streams from the Anthropic API (`COACH_MODEL`) with the cached static system block, the last ~40 messages of the session (window grows in steps of 10 so the cached prefix stays stable), the cache marker on the newest user message, and the volatile context as a trailing system message
4. Claude responds as Brocco, potentially using tools (tool loop runs server-side; large `max_tokens` because `generate_plan` can emit 70+ workouts in one call)
5. If tool use (adjust_plan): apply immediately, log to plan_adjustment_log
6. If tool use (modify_plan): Brocco describes proposed changes conversationally and asks for confirmation. After user confirms in chat, Brocco applies changes directly via the tool
7. If tool use (log_health, log_activity, save_profile, manage_event, …): apply immediately, confirm in chat
8. If tool use (query_data, query_schedule, manage_recipe search): server executes the query, returns data to Claude, Claude continues
9. Responses end with a `[STATUS:question|done|info]…[/STATUS]` line the client renders as a strip; `:done` is only allowed when a tool actually succeeded in that message
10. Store message + response in chat_messages as jsonb content + display_text. Chat sessions are one per day (`POST /api/chat/sessions` reuses today's); finished days are condensed into cross-day memory by `src/lib/conversation-memory.ts`
11. `POST /api/chat/opener` generates a data-driven opening message at most once per local day (or again when a new activity landed), gated server-side by `profile.last_opener_at`

### AI Tool Definitions
Thirteen tools are defined in `src/lib/tools.ts` (`toolDefinitions`; schemas and handlers live there — that file is the source of truth, not this list). `toolsForFeatures` drops the feature-gated ones per request.

Coaching:
- **adjust_plan** — auto-applied micro-adjustments within the current week: retarget distance/pace/duration, move a session to another day this week, reduce intensity, mark covered. Logged to `plan_adjustment_log`.
- **modify_plan** — structural changes (add/delete/update/skip workouts, anything beyond 7 days, week targets), applied only after the user confirmed in chat. One workout = one sport, one session (bricks and doubles become separate rows so watch sync stays clean).
- **generate_plan** — builds a plan with the rolling horizon: phases, `plan_weeks` for every week, workouts only for detailed (1-2) and outline (3-4) weeks. Monday–Sunday weeks.
- **log_health** — health/injury log entry, applied immediately.
- **log_activity** — manual activity not on Strava, applied immediately.
- **query_data** — historical training data on demand (activities, weekly summary, pace/HR trends, comparisons).
- **save_profile** — typed profile fields + deep-merged `coaching_notes_update`.
- **manage_weekly_goals** — set/list/remove/resolve "N times this week" goals; progress is credited automatically.
- **add_weekly_tasks** — checklist items for a plan week (strength, mobility, nutrition, recovery).
- **create_workout** — a guided S&C session for the in-app timer, using illustrated exercise names from the diagram registry.

Life planner (feature-gated):
- **manage_event** (calendar) — create/update/delete calendar events incl. recurrence and birthdays; occurrence-level delete via `delete_scope=occurrence` (adds an exdate).
- **query_schedule** (calendar) — merged events + planned workouts for a date range, rendered day-by-day; used to answer schedule questions and detect conflicts before adding anything.
- **manage_recipe** (kitchen) — search/get/save/cooked/delete recipes and manage pantry staples.

### Auto-Matching Activities to Plan
Matching is a read-time rule shared by the plan tab, chat context, opener, calendar and Today (`src/lib/plan-progress.ts`): a planned workout counts as done when a compatible-type activity (`src/lib/activity-types.ts` maps run/cycle/swim/hike/strength/climb to Strava sport types) exists on the same calendar day in the user's timezone — regardless of whether that activity came from Strava, was logged via chat, was recorded by the workout player, or was created by the Done button (`POST /api/workouts/[id]/resolve`). For sessions the app cannot see (climbing, off-app strength), Today and the calendar show Done/Skipped buttons (`src/app/resolve-buttons.tsx`) instead of calling the session missed; "done" logs a manual activity on that day unless a compatible one already exists.

### Context Builder
`buildCoachContext(userId)` in `src/lib/coach-context.ts` assembles the AI context for each chat message:

```typescript
async function buildCoachContext(userId: string): Promise<string> {
  // 1. Profile: goals, experience, preferences, timezone, primary sport
  // 2. Coaching notes: injury history, preferences, race history, constraints (from user_profiles.coaching_notes)
  // 3. Current plan: next 14 days of planned workouts, with done/skipped state
  // 4. Recent activities: last 14 days (summarized, not raw JSON) + analysis for quality sessions
  // 5. Training load: weekly km (or sessions/minutes for non-running sports) for last 8 weeks
  // 6. Health notes: all active entries from health_log for this user
  // 7. Weekly goals, 7-day schedule block, recent conversation memory
  // 8. Format as structured text for the system prompt
}
```

Keep the context concise — summarize activities (don't dump raw JSON), use tables where helpful, highlight deviations from plan.

## API Route Structure

Every route under `src/app/api` (`find src/app/api -name route.ts` is the truth):

```
# Auth
/api/auth/login            — POST: email + password, set session cookie (rate-limited)
/api/auth/logout           — POST: clear session cookie
/api/auth/signup           — POST: create account with the shared access code
/api/auth/forgot           — POST: request a password reset email (always 200)
/api/auth/reset            — POST: set a new password with an emailed token
/api/auth/password         — POST: change password (current password required; bumps session epoch)
/api/auth/email            — POST: change email (current password required; bumps session epoch)
/api/auth/delete-account   — POST: delete the account and all data (password-confirmed)

# Strava
/api/strava/auth           — GET: redirect to Strava OAuth (user-scoped)
/api/strava/callback       — GET: handle OAuth callback, store tokens, start backfill
/api/strava/webhook        — GET: webhook verification, POST: activity events
/api/strava/sync           — POST: manual sync for current user (3/hour)
/api/strava/auto-sync      — GET: silent once-per-local-day incremental sync, called on app open
/api/strava/disconnect     — POST: unlink Strava, keep imported activities
/api/strava/activities     — GET: list activities for current user (pagination, filters)
/api/activities/[id]       — GET: one activity with analysis
/api/activities/[id]/analyze — POST: on-demand (re-)analysis
/api/trends                — GET: 90-day pace curve + 8-week zone mix for History

# Chat
/api/chat                  — POST: send message, get AI response (SSE stream, tool loop)
/api/chat/opener           — POST: contextual opening message, or {skipped:true}
/api/chat/sessions         — GET: list sessions, POST: create (or reuse today's) general/kitchen session
/api/chat/sessions/[id]    — GET: session with messages (verify ownership)

# Plan
/api/plan                  — GET: active plan for current user
/api/plan/promote          — POST: promote outline weeks to detailed (rolling horizon)
/api/plan/tasks            — GET ?week=N: weekly tasks, PATCH: toggle task status
/api/workouts/[id]/detail  — GET: one planned session with prescription, last adjustment, comparable session
/api/workouts/[id]/resolve — POST {outcome: done|skipped, durationMin?}: "did it happen?" answer
/api/goals                 — GET: this week's flexible goals with live progress

# Voice
/api/voice/transcribe      — POST: audio file → Groq Whisper → { text }

# Today, calendar, reviews
/api/today                 — GET: everything the Today screen needs (agenda, week summary, upcoming)
/api/briefing              — GET: cached morning briefing (smart-trigger regeneration; ?refresh=1 forces, 10/hour)
/api/weekly-review         — GET: week recap + next-week preview (Sunday 17:00 through Monday)
/api/events                — GET: ?from&to expanded occurrences + read-through workouts, POST: create
/api/events/[id]           — GET, PUT, DELETE (?scope=occurrence&date= for single occurrence)
/api/calendar/token        — POST: create or rotate the ICS subscribe URL
/api/calendar/ics          — GET ?token=: public read-only ICS feed

# Guided workouts
/api/guided-workouts       — GET: saved workouts, POST: save one
/api/guided-workouts/[id]  — GET, PATCH (pin), DELETE
/api/guided-workouts/generate — POST: build a session for a planned strength workout or a free request
/api/guided-workouts/sessions — POST: record a played session (completed ones log an activity)
/api/guided-workouts/sessions/[id] — DELETE: undo a recorded session and its activity

# Kitchen
/api/recipes               — GET ?q=, POST
/api/recipes/[id]          — GET, PUT, DELETE
/api/recipes/scan          — POST: extract a recipe from cookbook photos (20/hour)
/api/recipes/staples       — GET, PUT: pantry staples

# Watch sync
/api/intervals             — POST: connect intervals.icu (athlete id + API key), DELETE: disconnect
/api/intervals/sync        — POST: push the current plan window now

# Push
/api/push/vapid            — GET: public VAPID key
/api/push/subscribe        — POST, /api/push/unsubscribe — POST
/api/push/test             — POST: test notification to all devices

# Profile & misc
/api/profile               — GET, PUT (current user only: goals, timezone, hr max, language, sport, features…)
/api/profile/equipment     — GET, PUT: kit the athlete owns
/api/features              — GET: feature flags + language (public path, read on every load)
/api/health-check          — GET: unauthenticated liveness (process + DB) for Docker/Coolify
```

**Important:** Every API route (except the public paths listed under Auth & Signup Flow) must verify the session and scope queries to the authenticated user's ID. The middleware already returns 401 without a cookie, but routes still call `getSession()` themselves because that is where the session-epoch check happens.

## Page Structure

```
/login                    — Email + password login
/signup                   — Signup with the shared access code (?code= prefills it)
/forgot-password, /reset-password — Password reset
/                         — Redirects to /today
/today                    — Home screen: morning briefing + today's agenda + weekly goals + weekly review
/calendar                 — Day/week/month calendar with events + plan workouts (feature-gated)
/chat                     — Brocco chat with voice support (today's session)
/chat/[sessionId]         — Specific chat session
/kitchen                  — Recipe library, scan, staples (feature-gated)
/kitchen/chat, /kitchen/chat/[sessionId] — Kitchen chat
/workout                  — Guided workouts: library, presets, player
/more                     — Submenu: Training Plan, History, Workouts, Kitchen, Settings, Imprint
/plan                     — Full training plan: phases, weeks, workouts; New Plan button
/history                  — All past activities with search, filters and trends
/activity/[id]            — One activity with its analysis
/settings                 — Profile, goals, HR max, language, primary sport, feature toggles, Strava, watch sync, ICS feed, push, equipment, email/password, delete account
/legal                    — Imprint (Impressum) and privacy policy
```

## Implementation Order (Phase 1 — MVP) — done

The step-by-step build order that used to live here has shipped; the sections above describe the app as built. Where the build diverged from the plan: there is no `/onboarding` page and no `chat_sessions.type = 'onboarding' | 'plan_creation'` in use; invite codes became a shared access code; plans are created with the `generate_plan` tool rather than `modify_plan`; model ids moved to `src/lib/models.ts`; and the dashboard became the Today screen.

## Style Guide

- Light "sticker" theme derived from the mascot artwork (tokens in `src/app/globals.css` — see the memory note `sticker-design-system.md`); never use raw gray/dark Tailwind colors
- Mobile-first: large touch targets, readable text, minimal scrolling
- Color-code workout types (`src/lib/categories.ts`):
  - Easy/Recovery: green
  - Tempo: orange
  - Interval: red
  - Race Pace: dark orange
  - Long: blue
  - Cross-training: teal
  - Strength: purple
  - Climbing: brown
  - Rest: grey
  - Race: gold
- Charts: simple, clean, minimal gridlines
- Chat UI: clean message bubbles, clear distinction between user and Brocco, mascot avatar shown
- Voice UI: prominent microphone button, pulsing indicator when recording, live transcript while dictating
- Brocco branding: mascot in chat header, "brocco.run" in app chrome, green accent where appropriate

## Brocco — The Coach

Brocco 🥦 is the app's sole AI coach identity. No coach selection — Brocco is who you get.

**Personality:** A broccoli with deep exercise physiology knowledge. Aggressively healthy energy. Inexplicably competitive for a vegetable. Data-driven and direct. Uses vegetable/garden metaphors sparingly — they're seasoning, not the main dish. Treats recovery like soil and sunlight. Takes your training seriously even though it's a broccoli. Coach first, broccoli second. For a non-running primary sport the persona becomes "a <sport> coach" and the volume language switches to sessions and minutes.

**System prompt:** See `ai-running-coach-concept.md` for the original personality block; the live prompt is `buildSystemPrompt` in `src/lib/coach-context.ts`.

## Environment Variables

`.env.example` is the reference; `src/lib/env.ts` enforces the required ones at boot.

```
# Required (boot fails without them)
DATABASE_URL=postgresql://...
SESSION_SECRET=...             # iron-session cookie password (32+ chars)
BASE_URL=https://brocco.run    # production URL for OAuth callbacks, reset links, ICS URLs
ANTHROPIC_API_KEY=...          # read by the Anthropic SDK

# Recommended (warned at boot if missing)
TOKEN_ENCRYPTION_KEY=...       # encrypts Strava / intervals.icu tokens; falls back to SESSION_SECRET
STRAVA_WEBHOOK_SUBSCRIPTION_ID=... # printed by scripts/register-strava-webhook.ts; events without it are rejected
SIGNUP_ACCESS_CODE=...         # shared signup code (defaults to brocco2026)

# Integrations
STRAVA_CLIENT_ID=...           # from Strava developer portal
STRAVA_CLIENT_SECRET=...
STRAVA_WEBHOOK_VERIFY_TOKEN=...# random string for webhook verification
GROQ_API_KEY=...               # Whisper speech-to-text (console.groq.com)
RESEND_API_KEY=...             # password reset email
EMAIL_FROM="Brocco <no-reply@brocco.run>"
VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...   # Web Push (npx web-push generate-vapid-keys)

# Ops / dev only
SEED_PASSWORD=...              # bootstrap the seed account on a brand-new production DB
GEMINI_API_KEY=... GEMINI_IMAGE_MODEL=... # scripts/gen-exercise-art.ts only
FIXTURE_EMAIL=...              # scripts/dev-fixture-current-week.ts only
```

## Notes

- This is a **multi-user** app behind a shared signup code. Every database query MUST be scoped by `user_id`.
- Strava is the primary source of activity data. Manual activities can be logged via AI chat, the workout player, or the Done button.
- **Two models, one file:** `COACH_MODEL` (Opus 5) for anything conversational or tool-calling, `UTILITY_MODEL` (Sonnet 5) for narrow extraction. Change models in `src/lib/models.ts` only.
- **Two-tier plan changes:** Brocco auto-applies micro-adjustments within the current week (logged to `plan_adjustment_log` with undo). Structural changes (new/deleted workouts, type changes, anything >7 days out, phase/mileage changes) are proposed conversationally in chat — Brocco describes the changes, user confirms in natural language, Brocco applies directly. No button-based approval flow.
- Keep chat context lean by summarizing activity data, not dumping raw Strava JSON. Use `query_data` tool for historical lookups.
- Store Strava tokens encrypted. Don't log them.
- Display "Powered by Strava" attribution where required.
- **Strava brand compliance:** Use official "Connect with Strava" button for OAuth. Display "Powered by Strava" logo in footer on every page. Add "View on Strava" links (orange #FC4C02 or underlined) on every activity in /history and Today. Strava logo must never be larger or more prominent than Brocco branding.
- **Legal page (/legal):** Imprint (Impressum) with operator name/email + privacy policy. Required because site is publicly accessible and operator is EU-based. Link in footer next to "Powered by Strava".
- All date matching uses the user's configured timezone (user_profiles.timezone). Use `date-fns-tz`.
- Store both `start_date` (UTC) and `start_date_local` (user TZ) on activities.
- **Activity Streams Analysis:** For eligible sessions, fetch streams and laps from Strava, process into `activity_analysis` jsonb on the activity record, discard raw streams. Runs from the webhook, the sync paths, and on demand (`/api/activities/[id]/analyze`). Included in AI context for recent quality sessions. See concept doc Phase 3 for the original spec.
- Chat messages store content as jsonb (raw Anthropic format) + display_text (human-readable).
- The app should work perfectly as text-only chat. Voice is an enhancement layer.
- Register the Strava app at https://www.strava.com/settings/api — callback URL must match BASE_URL.
- Strava webhook subscription is per-app (not per-user). Register once with the script, route events by athlete_id.
- Webhook only works on publicly accessible URLs — use ngrok for local development.
- Error handling: toast notifications for frontend errors (`src/lib/toast.ts` / `ToastHost`), structured JSON logging server-side. Never swallow errors silently.
- Dev scripts (`scripts/dev-check-*.ts`, `scripts/plan-health.mjs`, `scripts/dev-fixture-current-week.ts`) exercise the coach and plan logic against a local DB; `dev-check-coach-live.ts` and `dev-check-opener-numbers.ts` call the real model.
