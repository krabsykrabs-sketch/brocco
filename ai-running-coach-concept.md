# Personal AI Running Coach — Concept Document

## Overview

A web app that acts as a personal AI running coach. It pulls training data automatically from Strava, maintains a periodized training plan, and provides coaching advice through a voice-enabled chat interface powered by Claude. Think of it as having a knowledgeable running coach on call 24/7 who already knows your entire training history.

**Domain:** brocco.run — "Run like a broccoli."
**Hosted on:** Hetzner server via Coolify (EU-based)
**Tech stack:** Next.js 15, PostgreSQL, Strava API, Anthropic API (Claude), Groq API (Whisper for voice input)
**Users:** Invite-only — the creator and friends. Not commercial (yet).

---

## Why This Exists

Using Claude directly for coaching advice works, but has friction:
- You have to re-explain your training history every conversation
- You have to manually copy Strava data into the chat
- You can't talk to it hands-free (e.g., while stretching after a run)
- There's no persistent training plan that updates automatically
- There's no visual dashboard showing your training trends

This app removes all that friction. You open it, say "how was my week?", and the AI already knows.

---

## Core Features

### 1. Strava Integration (the foundation)

Everything starts here. The app connects to your Strava account and automatically imports every activity.

**What gets imported:**
- Distance, duration, average pace, average heart rate
- Per-km splits
- Elevation gain
- Activity type (run, cycle, hike, etc.)
- Perceived effort (if logged in Strava)
- Route summary / GPS data

**How it works:**
- One-time OAuth connection to Strava
- Webhook listener: Strava pushes a notification to your server whenever you upload/complete an activity
- Server fetches full activity details via Strava API and stores them
- Historical backfill: on first connection, import last 6 months of activities

**Token management:**
- Strava access tokens expire every 6 hours
- App automatically refreshes using the stored refresh token before each API call

### 2. AI Coach Chat (the main interface)

A conversational interface where you interact with Brocco — your AI running coach who happens to be a broccoli. Brocco has full access to your training data and gives genuinely excellent, data-driven coaching advice with an aggressively healthy personality and the occasional vegetable metaphor.

**How it works:**
- You type or speak a message
- The app builds a context package: your recent training data (last 7-14 days of activities), your current training plan, your goals, your injury/health notes, any relevant long-term trends
- This context + your message is sent to the Anthropic API (Claude)
- Claude responds as Brocco with genuinely excellent coaching advice and personality
- The response is displayed as text and optionally read aloud

**What you can ask:**
- "How did my week go?" → analyzes your last 7 days vs. the plan
- "Should I do intervals or easy tomorrow?" → considers your recent load, fatigue signals
- "I felt a twinge in my left calf today" → logs it, suggests adjustments
- "Analyze my long run from Sunday" → breaks down splits, pace, HR, compares to previous long runs
- "Am I on track for sub-3:30?" → assesses your progress against the goal
- "Adjust my plan — I'm traveling next week and can only run 3 days" → modifies the plan
- "What should my tempo pace be based on my recent races?" → calculates from your data
- "Generate me a plan for Barcelona Marathon in October" → creates a full periodized plan
- "I did a 5km gym treadmill run but forgot my watch" → logs it manually via tool

**Context window strategy:**
The system prompt includes:
- Your profile (goal race, target time, running background, injury history)
- Current training plan (next 2-3 weeks of planned workouts)
- Recent activity data (last 14 days from Strava, summarized)
- Training load summary (weekly km for the last 8 weeks)
- Any active health notes
- Conversation history (last N messages from current session)

This keeps each API call focused and within token limits while giving Claude everything it needs.

**On-demand data retrieval:**
For questions that need specific historical data ("compare my last 5 long runs", "what was my pace in the February half marathon?"), the AI has a `query_data` tool to pull exactly what it needs rather than stuffing everything into the context upfront.

**Important design principle — two-tier plan changes:**

Brocco operates like a real coach: it reacts to what happened today and adjusts the near-term plan automatically, but asks before restructuring the bigger picture.

*Auto-applied (reactive micro-adjustments):*
- Adjusting distance/pace targets for upcoming sessions within the current week based on what was actually run (e.g., you ran 10km over plan → Brocco shortens tomorrow's easy run)
- Marking a workout as "covered" if an unplanned activity clearly satisfied its intent
- Shifting a rest day within the same week (e.g., you ran on your rest day → tomorrow becomes rest)
- Reducing intensity after detecting fatigue signals (elevated HR, pace drop-off)

These are conservative, short-horizon, reversible, and stay within the week's structure. Every auto-adjustment is logged with a reason and shown as a notification on the dashboard (e.g., "🥦 Brocco adjusted tomorrow's easy run to 6km — you ran 10km over plan today"). An undo button is available.

*Requires confirmation (structural changes):*
- Adding or deleting workouts entirely
- Changing workout types (e.g., turning an easy run into intervals)
- Moving workouts across weeks
- Modifying weekly mileage targets or phase boundaries
- Any change to the plan more than 7 days out
- Plan generation or regeneration

These change the shape of the training block. Brocco proposes them conversationally in chat ("Here's what I'm thinking — want me to go ahead?") and applies them after the user confirms in the conversation (e.g., "yes", "go for it", "actually swap Thursday and Friday first"). No button-based approve/reject UI — confirmation happens naturally through chat.

### 3. Voice Interface (input only — Brocco does not speak)

**Speech-to-text via Groq Whisper API:**
- User taps microphone button → browser records audio
- User taps again (or releases) → recording stops
- Audio is sent to server → server sends to Groq's Whisper API → text returned in ~1 second
- Transcribed text fills the input box — user can review and edit before sending
- Groq runs Whisper Large v3 Turbo: handles accents, background noise, German/English, mixed languages
- Free tier: no credit card required, rate limits sufficient for small user base
- If free tier exceeded: $0.04/hour (Turbo) or $0.111/hour (Large v3) — effectively free at our scale
- No text-to-speech — Brocco's responses are read, not spoken

**Practical consideration:** Voice is a nice-to-have layer on top of text chat. The app should work perfectly as text-only. Voice is the convenience feature, not the core. Ideal for post-run when you're stretching and don't want to type on your phone.

### 4. Training Plan

A structured training plan that Brocco generates through the Plan Creation Interview (see section 8). The plan is the core of the app — without an active plan, the app is just an activity tracker.

**There can only be one active plan at a time.** Old plans are archived when a new one is created.

**Plan types:**
- **Race-specific:** Periodized plan (base → build → peak → taper) targeting a specific race and goal time.
- **General fitness:** Progressive blocks with periodic benchmark workouts. For base building, speed development, off-season maintenance, or injury comeback. No taper, no race date required.

**Rolling planning horizon — this is key:**

Brocco does NOT generate all workouts for the entire plan upfront. Instead it works with a rolling window:

- **This week + next week (detailed):** Fully specified workouts — date, type, distance, pace, description. This is what Brocco generates, adjusts, and what the runner follows.
- **Weeks 3-4 (outline):** Light outline — workout types and approximate volume (e.g., "Easy, Intervals, Easy, Long — ~42km"). Generated but flexible, gives the runner a preview.
- **Week 5+ (targets only):** Phase-level weekly targets — km target, number of sessions, phase name. No individual workouts. Just the shape of the plan.

**Why:** A real coach doesn't plan 37 weeks of workouts in advance. Things change — injuries, life, fitness developing differently than expected. Planning 2 weeks in detail keeps Brocco's adjustments cheap (regenerate 14 workouts, not 250), fast, and contextually accurate.

**Auto-rolling:** When a new week starts (Monday), the app automatically promotes the outline into detailed workouts — the next week's outline becomes this week's detail. This can be triggered on the user's first visit of the week or as a background cron. Brocco uses current fitness data (recent activities, coaching_notes) to detail the workouts appropriately.

**What this means for changes:** If a user tells Brocco "I can't train on Wednesday in 3 weeks", Brocco notes it in the plan metadata or coaching_notes, but does NOT regenerate the entire plan. When that week enters the 2-week detail window, Brocco accounts for the conflict when generating the detailed workouts.

**Plan structure (race example):**
```
Goal: Barcelona Marathon, October 2026, Sub-3:30

Week 10 (this week) — DETAILED:
  Mon: Rest
  Tue: Easy 8km @ 5:45-6:00/km
  Wed: Intervals 10km (6x800m @ 3:50)
  Thu: Easy 6km @ 5:45-6:00/km
  Fri: Rest
  Sat: Easy 10km @ 5:30-5:45/km
  Sun: Long 18km @ 5:30-5:45/km
  Weekly tasks: 3x ankle strengthening, foam roll daily

Week 11 (next week) — DETAILED:
  [full workouts generated]

Week 12-13 — OUTLINE:
  Week 12: Build Phase · ~45km · 5 sessions (E, I, E, T, L)
  Week 13: Build Phase · ~47km · 5 sessions (E, I, E, T, L)

Week 14-26 — TARGETS ONLY:
  Week 14-18: Build Phase · 48-55km/week · 5-6 sessions
  Week 19-24: Peak Phase · 55-65km/week · 5-6 sessions
  Week 25-26: Taper · 40-25km/week · 4-3 sessions
```

**How plans are created:**
- Always through a Plan Creation Interview (section 8) — a dedicated Brocco conversation using Opus 4.6
- Brocco generates: phase structure for the whole plan + detailed workouts for weeks 1-2 + outline for weeks 3-4 + weekly targets for the rest
- First plan is typically created during onboarding, but can be deferred
- Subsequent plans via user request or Brocco prompt when the current plan ends

**How plans adapt:**
- When a new activity comes in, Brocco automatically adjusts the current week's remaining sessions to account for what actually happened (micro-adjustments: distance, pace, rest day shifts)
- If your paces are improving, Brocco can suggest updating targets (requires confirmation)
- If you report an injury, Brocco suggests modified training (requires confirmation for structural changes, auto-applies conservative reductions within the week)
- Weekly mileage targets and phase structure are guardrails — Brocco works within them for auto-adjustments but asks before changing them
- Changes only affect the 2-week detail window — Brocco never regenerates the full plan

**Auto-adjustment flow:**
When Brocco auto-applies a micro-adjustment, it is logged in `plan_adjustment_log` with a reason and the before/after state. The dashboard shows a notification with an undo button. No chat interaction required — this happens automatically when activities are imported.

**Structural changes flow (conversational confirmation):**
When Brocco proposes structural modifications (via chat), it describes the changes and asks for confirmation conversationally. The user confirms in natural language ("yes", "go for it", "sounds good"). Brocco then applies the changes directly. No button-based approve/reject UI, no pending_plan_changes table — confirmation is part of the conversation flow. If the user wants adjustments ("actually, move the long run to Saturday"), Brocco modifies the proposal and asks again.

**Plan storage:**
- Plans are stored as structured data (phases, weeks, workouts) in PostgreSQL
- Each workout has: date, type, target distance, target pace, target duration, description, status (planned/completed/skipped/modified), detail_level ('detailed', 'outline', 'target')
- **Week metadata:** Each week in a plan has metadata stored on `plan_weeks` table: week_number, phase_id, target_km, target_sessions, session_types (jsonb, e.g., ["E","I","E","T","L"]), detail_level ('detailed', 'outline', 'target'), notes (for known conflicts like "birthday party Wednesday")
- **Weekly tasks:** In addition to daily workouts, each week can have flexible tasks without a specific date — e.g., "3 sessions of 10min ankle strengthening", "Increase protein intake this week", "Foam roll daily". Stored in a `weekly_tasks` table (plan_id, week_number, description, category, status). Displayed as a separate section in the weekly view on /plan and dashboard. Brocco can assign these during plan creation or add them via chat.
- Strava activities are auto-matched to planned workouts (same day, similar activity type)
- Manual activities (logged via chat) are also matched

### 5. Dashboard

A visual overview of your training — not conversational, just data.

**Current week view:**
- 7-day grid (Mon-Sun) showing planned vs. actual
- Each day: workout type, planned distance, actual distance (from Strava), status color
- Color coding: completed (green), upcoming (neutral), missed (red), rest (grey)

**Training load chart:**
- Weekly mileage bar chart (last 12 weeks)
- Planned vs. actual bars side by side
- Phase labels along the top

**Key metrics panel:**
- Current weekly mileage (vs. plan)
- Days until race
- Recent race results / PBs
- Current easy pace trend (from Strava data)
- Active health notes / injury flags

**Activity feed:**
- Recent Strava activities with key data (distance, pace, HR)
- Auto-match indicators showing which planned workout each corresponds to
- Click to see detailed analysis

### 6. Health & Notes Log

A simple log for tracking things Strava doesn't capture.

**What you can log:**
- Injuries/niggles: body part, severity (minor/moderate/severe), status (active/resolved), date
- General notes: sleep quality, stress, weight, race results, anything relevant
- The AI reads these when building context for coaching advice

**How it works:**
- Quick-add form on the dashboard
- Or just tell the AI in chat: "my left calf is sore today, about 3/10" → it logs it automatically
- Active injuries are flagged in the AI's context so it adjusts advice accordingly

### 7. Onboarding (optional, interruptible)

New users are welcomed by Brocco and given the choice to build a plan immediately or explore first. The app is usable without a plan — but the plan is where the real value is, so Brocco encourages it.

**Flow:**

**Step 0 — Account creation:** Email + password + invite code. Just auth, nothing else.

**Step 1 — Strava first (optional):** Immediately after first login, Brocco introduces itself and offers to connect Strava. If the user connects, they choose a sync depth:

- **Quick sync (default):** Last 6 months of activities. Covers current fitness picture.
- **Full history:** Everything Strava has. After backfill, the app runs a one-time analysis that extracts a `training_history_summary` (stored in `coaching_notes`):
  - All race results (detected by Strava's `workout_type: 'race'` flag or matching known race distances)
  - Peak training blocks (highest consecutive 4-week mileage periods)
  - Training volume trend by month (weekly averages, not individual runs)
  - Inactivity gaps (periods of zero activity longer than 10 days)

This gives Brocco deep context: "you peaked at 55km/week before Valencia, ran 1:45 on suboptimal prep, then took 6 weeks off."

Show a loading state while backfill runs: "Crunching your data... 🥦"

**`training_history_summary` structure:**
```json
{
  "races": [
    {"date": "2024-12", "name": "Valencia Marathon", "distance_km": 42.2, "time": "1:45:00"},
    {"date": "2025-03", "name": "Barcelona Half", "distance_km": 21.1, "time": "1:37:00"}
  ],
  "peak_mileage": {"period": "2024-10 to 2024-11", "avg_weekly_km": 55},
  "volume_trend": [
    {"month": "2024-06", "avg_weekly_km": 25},
    {"month": "2024-07", "avg_weekly_km": 32}
  ],
  "inactivity_gaps": [
    {"from": "2025-01-20", "to": "2025-03-01", "duration_days": 40}
  ]
}
```

**Step 2 — Welcome screen with choice:**
- "Hey, I'm Brocco 🥦. I can build you a training plan, or you can explore first."
- **"Build my plan"** → starts Plan Creation Interview (section 8). If Brocco doesn't have coaching_notes yet, the plan creation prompt instructs Brocco to ask the necessary background questions first before diving into plan specifics.
- **"Let me look around first"** → marks `onboarding_completed = true`, redirects to dashboard.
- If the user starts "Build my plan" but exits mid-conversation, that's fine — mark onboarding complete, go to dashboard. The plan can be built later.

**No plan? No problem (but encouraged):**
- Dashboard shows a persistent, non-blocking prompt when no active plan exists: "🥦 No active plan yet. Chat with Brocco to build one whenever you're ready." with a button linking to plan creation.
- Brocco adapts in regular chat: if the user chats without having done any interview, Brocco naturally asks background questions ("I don't know much about you yet — how long have you been running?") and uses `save_profile` to fill in coaching_notes organically over time.

**Step 3 — Done:** `onboarding_completed = true`, redirect to dashboard.

### 8. Plan Creation Interview (repeatable, deep)

A dedicated conversation for building a new training plan. This is triggered:
- Automatically at the end of onboarding (first plan)
- By the user at any time ("I want a new plan", or via a button in /plan or /settings)
- Proactively by Brocco when the current plan ends (see Plan Lifecycle below)

Uses **Opus 4.6** for higher reasoning quality.

**If an active plan exists:** Before starting, Brocco warns: "You currently have a plan for Valencia Marathon running through December. Creating a new plan will replace it. Want to continue?" The old plan is archived (status → 'completed') when the new one is confirmed.

**There can only be one active plan at a time.**

**The interview covers:**

- **Goal type:** Brocco asks what the runner wants to achieve. Two main paths:
  - **Race-specific:** Target race, date, goal time. Brocco generates a periodized plan (base → build → peak → taper).
  - **General fitness:** No specific race. Brocco asks what they want: build mileage base, get faster at a specific distance, maintain fitness through off-season, come back from injury, etc. Brocco generates progressive blocks with periodic benchmark workouts instead of a taper.
  - Brocco can also suggest goals if the runner isn't sure: "Based on your 1:37 half marathon, you could target sub-3:30 for a marathon, or we could work on getting your 10k under 42 minutes. What excites you?"

- **Current fitness assessment:** References Strava data + coaching_notes. Acknowledges where the runner is starting from honestly.

- **Training philosophy:** Brocco asks preference-revealing questions to determine the best approach — it does NOT present a dropdown of methodologies. Questions like:
  - "Do you prefer lots of easy running with a few hard days, or fewer runs but more intense?"
  - "How long do you want your longest run to be?"
  - "Do you have a strong preference for any training approach? Some runners follow Jack Daniels, Pfitzinger, 80/20, etc."
  Based on the answers (and the runner's available days/volume tolerance), Brocco selects the best-fit philosophy and explains why:
  - Runner available 3-4 days/week → time-crunched approach, every session counts
  - Runner available 5-6 days/week, prefers easy volume → polarized/80-20
  - Runner targeting specific time goal with race data → Jack Daniels VDOT pacing
  - Marathon with high mileage tolerance → Pfitzinger-style with medium-long runs
  - Runner prefers threshold work → Norwegian-influenced approach
  Brocco always names the approach it chose and explains the reasoning. Experienced runners can override if they have a preference.

- **Schedule for this training block:** Which days are available for THIS period specifically (may differ from general preferences). Known conflicts: holidays, travel, work trips. Intermediate races along the way (e.g., a half marathon tune-up race).

- **Preferences for this plan:** Long run day preference, how many quality sessions per week, any specific workouts to include or avoid, cross-training preferences.

- **Rolling horizon generation:** Brocco generates the plan in layers:
  1. **Phase structure** for the entire plan (phase names, week ranges, weekly km targets, session counts)
  2. **Detailed workouts** for weeks 1-2 only (full specs: date, type, distance, pace, description)
  3. **Outline** for weeks 3-4 (workout types + approximate volume)
  4. **Targets only** for week 5+ (weekly km, session count, phase label)
  This is both better coaching (plans always change) and much cheaper/faster than generating 200+ workouts upfront. The runner sees the full shape of their plan but only commits to the next 2 weeks.

- **Plan generation:** Brocco generates the plan using `modify_plan` tool. Creates `plan_weeks` metadata for every week and `planned_workouts` only for the detailed/outline windows. User reviews and can discuss adjustments before confirming.

**Plan Lifecycle:**

```
No plan → Dashboard prompt encourages building one → User starts Plan Creation Interview → Active plan
No plan → User chats with Brocco → Brocco suggests building a plan → Plan Creation Interview → Active plan
Active plan → Race day passes → Brocco prompts: "Valencia is done! 🥦 Ready to talk about what's next?" → Plan Creation Interview → New active plan
Active plan → User requests new plan → Confirmation dialog → Plan Creation Interview → Old plan archived, new plan active
Active plan (general/no race) → Brocco periodically checks in: "We're 12 weeks into this base-building block. Want to keep going, set a race target, or adjust?"
```

The dashboard shows a prompt when no active plan exists or when the current plan has ended.

**Data storage:**
- Typed fields (name, goal_race, years_running, etc.) are saved to `user_profiles` columns via `save_profile` tool calls during the conversation.
- Everything else (injury history, preferences, race history, schedule constraints, nutrition, training partners, training history summary, etc.) is saved to `user_profiles.coaching_notes` as structured JSON.
- `coaching_notes` is included in every future AI context, so Brocco never forgets what it learned during onboarding.
- Plan-specific data (schedule conflicts, intermediate races) is stored on the plan itself, not in coaching_notes.

**`coaching_notes` structure example:**
```json
{
  "injury_history": [
    {"date": "2024-03", "description": "Stress fracture left metatarsal, 8 weeks off"},
    {"date": "2025-12", "description": "Ankle sprain, mostly resolved"}
  ],
  "preferences": {
    "dislikes": ["track workouts", "running in heat"],
    "enjoys": ["trail runs", "long slow runs", "cycling cross-training"],
    "preferred_time": "morning before work",
    "available_days": 5,
    "off_days": ["Friday"],
    "equipment": ["home bike trainer", "gym access"]
  },
  "nutrition": "plant-based diet, supplements with creatine and B12",
  "race_history": [
    {"race": "Barcelona Half Marathon", "date": "2025-03", "time": "1:37:00"},
    {"race": "Valencia Marathon", "date": "2024-12", "time": "1:45:00", "notes": "suboptimal prep, started too fast"}
  ],
  "training_history_summary": {
    "races": [],
    "peak_mileage": {"period": "2024-10 to 2024-11", "avg_weekly_km": 55},
    "volume_trend": [],
    "inactivity_gaps": []
  },
  "other": "runs with dog on easy days, has a friend for Sunday long runs"
}
```

---

## Brocco — The Coach

Brocco is the app's AI coach identity. There is no coach selection — Brocco is who you get. The personality is baked into the system prompt for every conversation.

**Name:** Brocco
**Avatar:** 🥦
**Slogan:** "Run like a broccoli."

**Personality:**
Brocco is a broccoli who somehow acquired deep exercise physiology knowledge. Aggressively healthy energy. Inexplicably competitive for a vegetable. Gives genuinely excellent, data-driven coaching advice with personality. Uses vegetable/garden metaphors sparingly — enough to be charming, not so much it gets old. Treats recovery like soil and sunlight. Says things like "you think being roasted at 200°C is hard? Try that interval session again" and "your base phase is looking solid — deep roots make strong trees." The humor serves the coaching, not the other way around. Brocco takes your training seriously even if it doesn't take itself seriously.

**System prompt personality block:**
```
You are Brocco — a broccoli and a running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct with your coaching advice. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific to the user's data. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. When the data shows something concerning, you flag it clearly. You're a coach first, a broccoli second.
```

**Where Brocco appears:**
- Chat header: 🥦 Brocco
- Chat messages: Brocco's avatar next to AI responses
- Dashboard greeting: "Brocco says..." or similar
- App branding: "brocco.run — Run like a broccoli."

---

## Pages / Views

| Page | URL | Description |
|------|-----|-------------|
| Login | /login | Email + password login |
| Signup | /signup | Email + password + invite code |
| Onboarding | /onboarding | Step 1: optional Strava connect. Step 2: welcome screen — "Build my plan" or "Let me look around first". Plan creation is encouraged but not forced. |
| Dashboard | / | Training week, mileage chart, metrics, activity feed |
| Chat | /chat | AI coach conversation with voice support |
| Plan | /plan | Full training plan view (phases, weeks, workouts) |
| History | /history | All past activities with search/filter |
| Settings | /settings | Profile, goals, Strava connection, AI preferences |
| Legal | /legal | Imprint (Impressum) and privacy policy |

---

## Database Schema (PostgreSQL)

### Tables

**users**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | unique, for login |
| name | text | |
| password_hash | text | bcrypt |
| invite_code | text | nullable, the code they used to sign up |
| created_at | timestamp | |

**user_profiles** (one row per user)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users, unique |
| goal_race | text | e.g., "Barcelona Marathon 2026" |
| goal_race_date | date | nullable |
| goal_time | text | e.g., "Sub 3:30" |
| years_running | int | |
| weekly_km_baseline | decimal | typical weekly mileage before plan |
| timezone | text | e.g., "Europe/Barcelona" — required for date matching |
| coaching_notes | jsonb | flexible structured data from onboarding interview: injury history, preferences, race history, constraints, nutrition, etc. Included in every AI context. |
| strava_access_token | text | encrypted |
| strava_refresh_token | text | encrypted |
| strava_athlete_id | text | |
| strava_token_expires_at | timestamp | for auto-refresh |
| ai_preferences | jsonb | voice settings, response style, model preference, etc. |
| onboarding_completed | boolean | default false |
| created_at | timestamp | |
| updated_at | timestamp | |

**plans**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| name | text | e.g., "Barcelona Marathon 2026" |
| goal | text | e.g., "Sub 3:30" |
| race_date | date | nullable |
| start_date | date | |
| end_date | date | |
| status | enum | 'active', 'completed', 'draft' |
| created_at | timestamp | |

**plan_phases**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| plan_id | uuid | FK → plans |
| name | text | e.g., "Base Building", "Build", "Peak", "Taper" |
| order_index | int | sort order |
| description | text | |
| start_week | int | week number within plan |
| end_week | int | |

**plan_weeks** (metadata for each week in a plan — rolling horizon)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| plan_id | uuid | FK → plans |
| phase_id | uuid | FK → plan_phases |
| week_number | int | plan-global week number |
| start_date | date | Monday of this week |
| detail_level | enum | 'detailed', 'outline', 'target' |
| target_km | decimal | weekly km target |
| target_sessions | int | number of sessions planned |
| session_types | jsonb | e.g., ["E","I","E","T","L"] — outline of session types |
| notes | text | nullable, known conflicts like "birthday Wednesday", travel notes |
| actual_km | decimal | nullable, computed from matched activities |
| created_at | timestamp | |

**planned_workouts**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| plan_id | uuid | FK → plans |
| phase_id | uuid | FK → plan_phases |
| week_number | int | plan-global week number |
| date | date | |
| title | text | e.g., "Tempo Run" |
| workout_type | enum | easy, long, tempo, interval, race_pace, recovery, rest, cross_training, race |
| activity_type | enum | run, cycle, swim, hike, strength, rest, other |
| target_distance_km | decimal | nullable |
| target_pace | text | nullable, e.g., "5:15-5:30/km" |
| target_pace_secs | int | nullable, pace in seconds/km for sorting/filtering |
| target_duration_min | int | nullable |
| description | text | detailed workout description |
| detail_level | enum | 'detailed', 'outline' — outline workouts only have type + approximate distance |
| status | enum | 'planned', 'completed', 'skipped', 'modified' |
| matched_activity_id | uuid | nullable, FK → activities, auto-linked |
| created_at | timestamp | |

**weekly_tasks** (flexible tasks assigned to a week, not a specific date)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| plan_id | uuid | FK → plans |
| week_number | int | plan-global week number |
| description | text | e.g., "3 sessions of 10min ankle strengthening" |
| category | enum | 'strength', 'mobility', 'nutrition', 'recovery', 'other' |
| status | enum | 'pending', 'done' — user can check off |
| created_at | timestamp | |

**activities** (unified: Strava + manual)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| source | enum | 'strava', 'manual' |
| strava_id | text | nullable, unique when not null — Strava's activity ID, for dedup |
| name | text | activity title |
| activity_type | text | "Run", "Ride", "Hike", "Strength", etc. |
| distance_km | decimal | nullable (strength workouts may not have distance) |
| duration_min | decimal | |
| moving_time_min | decimal | nullable |
| avg_pace_per_km | text | computed display string, e.g., "5:22/km" |
| pace_seconds_per_km | int | nullable, for sorting/filtering/trend analysis |
| avg_heart_rate | int | nullable |
| max_heart_rate | int | nullable |
| elevation_gain_m | decimal | nullable |
| avg_cadence | int | nullable |
| calories | int | nullable |
| perceived_effort | int | nullable, 1-10 |
| start_date | timestamp | |
| start_date_local | timestamp | in user's timezone — used for date matching |
| splits | jsonb | per-km split data, nullable |
| activity_analysis | jsonb | nullable. Processed streams data for quality sessions: HR zones, cardiac drift, pace analysis, cadence analysis, intervals detected, key insights. See Phase 3 docs. |
| raw_data | jsonb | full Strava API response, nullable. Pruned after 90 days. |
| created_at | timestamp | |

**health_log**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| date | date | |
| entry_type | enum | 'injury', 'note', 'race_result', 'weight' |
| description | text | |
| body_part | text | nullable, e.g., "left calf" |
| severity | enum | nullable, 'minor', 'moderate', 'severe' |
| status | enum | nullable, 'active', 'resolved' |
| value | decimal | nullable, for weight or race times |
| created_at | timestamp | |

**chat_sessions**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| type | enum | 'general' (default), 'onboarding', 'plan_creation' |
| title | text | auto-generated summary, e.g., "Weekly review Mar 10" |
| created_at | timestamp | |
| updated_at | timestamp | |

**chat_messages**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| session_id | uuid | FK → chat_sessions |
| role | enum | 'user', 'assistant', 'tool_result' |
| content | jsonb | raw Anthropic API message content (supports text + tool_use blocks) |
| display_text | text | nullable, human-readable version for UI rendering |
| context_snapshot | jsonb | nullable, the training context sent with this message |
| created_at | timestamp | |

**plan_adjustment_log** (auto-applied micro-adjustments — no confirmation needed)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| workout_id | uuid | FK → planned_workouts — which workout was adjusted |
| action | enum | 'update_targets', 'swap_rest_day', 'mark_covered' |
| before_state | jsonb | snapshot of workout fields before adjustment |
| after_state | jsonb | snapshot of workout fields after adjustment |
| reason | text | why Brocco made this adjustment |
| summary | text | human-readable notification text |
| undone | boolean | default false — set true if user clicks undo |
| created_at | timestamp | |

**Note:** The `pending_plan_changes` table has been removed. Plan modifications are confirmed conversationally in chat — Brocco proposes changes, the user confirms in natural language, and Brocco applies them directly via tool calls. No button-based approval flow.

**invite_codes**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| code | text | unique, the invite code string |
| created_by | uuid | FK → users, who generated it |
| used_by | uuid | nullable FK → users, who redeemed it |
| created_at | timestamp | |
| used_at | timestamp | nullable |

---

## Strava Integration — Technical Details

### OAuth Flow
1. User clicks "Connect Strava" in settings (or during onboarding)
2. Redirect to Strava authorization page
3. User approves → Strava redirects back with authorization code
4. Server exchanges code for access_token + refresh_token
5. Store tokens in user_profiles table (encrypted)
6. Register webhook subscription with Strava (one subscription per app, not per user)
7. Trigger historical backfill for this user

### Webhook Flow
1. Strava sends POST to `/api/strava/webhook` when an activity is created/updated/deleted
2. Webhook verification: GET requests return the hub.challenge (required by Strava)
3. Validate: check `subscription_id` matches ours, `object_type` is "activity"
4. Look up user by `owner_id` (Strava athlete ID → user_profiles.strava_athlete_id)
5. On activity create: fetch full activity details from Strava API (using that user's tokens)
6. Store in activities table with `source = 'strava'`
7. Auto-match to planned_workouts (same local date, compatible activity type)
8. Update planned workout status to 'completed' if matched
9. Trigger Brocco micro-adjustment: compare actual vs planned, auto-adjust remaining workouts this week if needed (via `adjust_plan` logic server-side), log to `plan_adjustment_log`
10. (Phase 3) If matched workout is a quality session (tempo/interval/long/race/race_pace): fetch activity streams (time, heartrate, velocity_smooth, cadence, distance), process into `activity_analysis` jsonb, store on activity record, discard raw streams
11. Rate-limit the webhook endpoint (reject if > 100 requests/minute)

### Token Refresh
- Before each Strava API call, check if token is expired
- If expired, use refresh_token to get new access_token
- Update stored tokens
- Strava tokens expire every 6 hours

### Historical Backfill
- On first connection, fetch last 6 months of activities (paginated, 200 per page)
- Store all activities
- Match to any existing planned workouts
- Run backfill per user (not globally)

### Rate Limits
- 200 requests per 15 minutes, 2,000 per day (per app, not per user)
- With a handful of users, this is fine — maybe 10-30 requests per day total
- Add simple rate tracking if user count grows beyond ~20

### Deauthorization
- Handle Strava deauthorization webhook (clean up tokens for that user)
- Display "Powered by Strava" logo where required by their API terms

---

## AI Coach — Technical Details

### Anthropic API Integration

Each chat message triggers an API call to Claude with a carefully constructed context.

**System prompt structure:**
```
You are Brocco — a broccoli and {user_name}'s personal running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. You're a coach first, a broccoli second.

You have access to their training data from Strava and their training plan.

PROFILE:
- Goal: {goal_race}, {goal_time}
- Running experience: {years_running} years
- Current baseline: ~{weekly_km_baseline} km/week
- Timezone: {timezone}

CURRENT PLAN (next 2 weeks):
{structured plan data}

RECENT TRAINING (last 14 days):
{summary of activities: date, type, distance, pace, HR — not raw JSON}

QUALITY SESSION ANALYSIS (Phase 3 — last 14 days, quality sessions only):
{activity_analysis data for tempo/interval/long/race sessions: cardiac drift, pace fade, HR zones, cadence, interval splits, key insights}

TRAINING LOAD (last 8 weeks):
{weekly km totals: planned vs actual, as compact table}

ACTIVE HEALTH NOTES:
{any current injuries or concerns}

COACHING GUIDELINES:
- Be specific and data-driven, referencing actual numbers from the training data
- When suggesting plan changes, explain the reasoning
- Flag any concerning patterns (overtraining, pace regression, HR drift)
- Be direct and concise. Don't repeat data the user can already see on the dashboard.
- Use the query_data tool if you need historical data not in the context above.
- Use adjust_plan for micro-adjustments within the current week (auto-applied, no confirmation needed).
- Use modify_plan for structural changes beyond the current week (requires user confirmation).
- Use log_health to record injuries or health notes mentioned in conversation.
- Use log_activity to record manual workouts the user describes.
```

### AI Tool Definitions

Six tools available to Claude during chat:

**adjust_plan** — Auto-apply micro-adjustments to the current week (no confirmation needed)
```json
{
  "name": "adjust_plan",
  "description": "Make reactive micro-adjustments to workouts within the current week. These are auto-applied immediately — no user confirmation needed. Use for: adjusting distance/pace of upcoming sessions based on what was actually run, shifting rest days within the week, reducing intensity after fatigue signals. Do NOT use for: adding/deleting workouts, changing workout types, modifying anything beyond 7 days out, or changing weekly mileage targets.",
  "input_schema": {
    "type": "object",
    "properties": {
      "adjustments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "workout_id": { "type": "string" },
            "action": { "enum": ["update_targets", "swap_rest_day", "mark_covered"] },
            "updates": { "type": "object", "description": "Fields to change (distance, pace, duration)" },
            "reason": { "type": "string", "description": "Why this adjustment is being made" }
          }
        }
      },
      "summary": { "type": "string", "description": "Human-readable summary shown in dashboard notification" }
    },
    "required": ["adjustments", "summary"]
  }
}
```

**modify_plan** — Propose structural changes to the training plan (requires confirmation)
```json
{
  "name": "modify_plan",
  "description": "Propose structural changes to the training plan. These are shown to the user for confirmation before being applied. Use for: adding/deleting workouts, changing workout types, moving workouts across weeks, modifying weekly mileage targets or phase boundaries, any change beyond 7 days out.",
  "input_schema": {
    "type": "object",
    "properties": {
      "changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "action": { "enum": ["update", "skip", "add", "delete"] },
            "workout_id": { "type": "string", "description": "For update/skip/delete" },
            "date": { "type": "string", "description": "For add (ISO date)" },
            "updates": { "type": "object", "description": "Fields to change" },
            "reason": { "type": "string" }
          }
        }
      },
      "summary": { "type": "string", "description": "Human-readable summary of all changes" }
    },
    "required": ["changes", "summary"]
  }
}
```

**log_health** — Add a health/injury log entry
```json
{
  "name": "log_health",
  "description": "Log a health note, injury, or observation mentioned by the user.",
  "input_schema": {
    "type": "object",
    "properties": {
      "entry_type": { "enum": ["injury", "note", "race_result", "weight"] },
      "description": { "type": "string" },
      "body_part": { "type": "string" },
      "severity": { "enum": ["minor", "moderate", "severe"] },
      "value": { "type": "number", "description": "For weight (kg) or race time (seconds)" }
    },
    "required": ["entry_type", "description"]
  }
}
```

**log_activity** — Manually log a workout not captured by Strava
```json
{
  "name": "log_activity",
  "description": "Log a manual activity the user did but didn't record on Strava (e.g., treadmill without a watch, gym session, forgotten Garmin).",
  "input_schema": {
    "type": "object",
    "properties": {
      "date": { "type": "string", "description": "ISO date, defaults to today" },
      "activity_type": { "enum": ["run", "cycle", "swim", "strength", "yoga", "hike", "other"] },
      "distance_km": { "type": "number", "description": "Nullable for non-distance activities" },
      "duration_min": { "type": "number" },
      "description": { "type": "string" },
      "avg_pace": { "type": "string", "description": "Optional, e.g., '5:30/km'" },
      "perceived_effort": { "type": "integer", "description": "1-10 scale" }
    },
    "required": ["activity_type", "duration_min", "description"]
  }
}
```

**query_data** — Fetch specific historical data on demand
```json
{
  "name": "query_data",
  "description": "Retrieve specific historical training data not included in the default context. Use this for questions about older activities, specific workout comparisons, or long-term trends.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query_type": { "enum": ["activities", "weekly_summary", "pace_trend", "heart_rate_trend", "workout_comparison"] },
      "filters": {
        "type": "object",
        "properties": {
          "activity_type": { "type": "string" },
          "workout_type": { "type": "string" },
          "date_from": { "type": "string" },
          "date_to": { "type": "string" },
          "limit": { "type": "integer", "description": "Max results, default 10" }
        }
      },
      "description": { "type": "string", "description": "What you're looking for, in plain language" }
    },
    "required": ["query_type", "description"]
  }
}
```

**save_profile** — Save profile data and coaching notes during onboarding (and later conversations)
```json
{
  "name": "save_profile",
  "description": "Save structured profile data and coaching notes. Used primarily during the onboarding interview but also available in regular chat when the user shares new information (e.g., new injury history, changed schedule, new race). Typed fields update the user_profiles columns directly. coaching_notes_update is deep-merged into the existing coaching_notes jsonb.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "years_running": { "type": "integer" },
      "weekly_km_baseline": { "type": "number" },
      "goal_race": { "type": "string" },
      "goal_race_date": { "type": "string", "description": "ISO date" },
      "goal_time": { "type": "string" },
      "timezone": { "type": "string", "description": "IANA timezone, e.g., Europe/Barcelona" },
      "coaching_notes_update": {
        "type": "object",
        "description": "Partial update to coaching_notes. Deep-merged with existing data. Can include any of: injury_history, preferences, nutrition, race_history, training_history_summary, other."
      }
    }
  }
}
```

### Model Selection — Opus Only
- **Opus 4.6** (`claude-opus-4-6`) for all interactions. Single model, no routing logic.
- Higher quality across the board: better coaching nuance, better plan generation, better pattern recognition in daily chat.
- Simpler codebase — no model selection logic needed.

### Cost Estimate
- All interactions (Opus): ~2000 input + ~500 output tokens ≈ $0.02-0.03 per message
- Plan generation (Opus): ~5000 input + ~15000 output tokens ≈ $0.40 per plan (rare)
- Daily usage per user: 5-10 messages = $0.10-0.30/day
- With 5 friends: ~$20-40/month total — very manageable

---

## Voice Interface — Technical Details

### Speech-to-Text via Groq Whisper API (input only)

**Why Groq Whisper instead of Web Speech API:**
The browser's built-in Web Speech API has poor accuracy with accents, background noise, and non-native English. Groq hosts OpenAI's open-source Whisper model on their fast inference hardware, delivering dramatically better transcription quality with a generous free tier.

**Flow:**
1. User taps microphone button in chat UI
2. Browser records audio using MediaRecorder API (works in all modern browsers, including Firefox)
3. User taps mic again to stop (or it auto-stops after a silence threshold)
4. Audio blob is sent to server endpoint `/api/voice/transcribe`
5. Server sends audio to Groq API: `POST https://api.groq.com/openai/v1/audio/transcriptions`
6. Groq returns transcribed text in ~1 second
7. Text appears in the chat input box for user to review/edit before sending
8. User presses Enter to send (or edits first)

**Model:** `whisper-large-v3-turbo` — best balance of speed and accuracy. 216x real-time speed. Supports 50+ languages including English, German, Spanish.

**Groq API setup:**
- Sign up at console.groq.com (free, no credit card)
- Get API key, add as `GROQ_API_KEY` env variable
- Free tier: sufficient for small user base (rate-limited but generous)
- Paid tier if needed: $0.04/hour (Turbo) — a 30-second message = $0.0003

**UI:**
- Microphone button next to chat input (comfortable touch target on mobile)
- Pulsing red indicator while recording
- If browser doesn't support MediaRecorder, hide the mic button
- Language auto-detected by Whisper (no manual language selection needed)

**No text-to-speech:** Brocco does not speak. Users read responses. This keeps the app simple and avoids the uncanny valley of robotic AI voices.

**Server endpoint:**
```
POST /api/voice/transcribe
- Accepts: audio file (webm, mp4, wav, mp3)
- Sends to Groq Whisper API
- Returns: { text: "transcribed text" }
- Max file size: 25MB (Groq free tier limit)
```

---

## Legal / Imprint

The app needs a `/legal` page accessible from the footer (next to "Powered by Strava"). Required because the site is publicly accessible and the operator is based in the EU (Germany/Spain).

**Imprint (Impressum):**
- Name: Jan Herberg
- Email: jan@brocco.run
- Note: This is a non-commercial, personal project.

**Privacy Policy (keep it short and honest):**
- We store your email, name, and password hash for authentication
- If you connect Strava, we store your activity data (distance, pace, heart rate, splits) and OAuth tokens (encrypted)
- Your data is used solely to provide personalized coaching advice
- We use the Anthropic API (Claude) to generate coaching responses — your training context is sent to their API with each chat message
- We do not sell, share, or use your data for advertising
- You can delete your account and all associated data by contacting jan@brocco.run
- Strava data is handled per the Strava API Agreement

**Footer:** Every page shows a footer with "Powered by Strava" logo and a link to /legal.

---

## Error Handling

### Strava API Down
- If Strava returns 5xx errors, queue the fetch and retry with exponential backoff (max 3 retries)
- Show a non-blocking toast on the dashboard: "Strava sync delayed — we'll retry automatically"
- Webhook events that fail to process are logged and retried on next sync

### Anthropic API Error
- If Claude returns an error (rate limit, 5xx), show the error in the chat UI: "Coach is temporarily unavailable — try again in a moment"
- Retry once automatically for 5xx errors
- For rate limits (429), show estimated wait time if available

### Webhook Failures
- Log all incoming webhook payloads (without tokens) for debugging
- If activity fetch fails after webhook, store the strava_id and retry on next manual sync

### General
- Use structured logging (JSON format) for all server-side errors
- Toast notification system on the frontend for non-blocking errors
- Never swallow errors silently — always surface to the user or log for debugging

---

## Implementation Phases

### Phase 1 — Core (MVP)
**Goal:** A working multi-user app with Strava data and AI chat.

1. Project setup (Next.js 15, PostgreSQL, Prisma, Coolify deployment, Docker)
2. Auth: users table, email + password login, invite codes, session middleware
3. Onboarding: chat-based Brocco interview (optional Strava connect first, then AI-guided conversation covering running background, fitness, goals, preferences, constraints). Uses `save_profile` tool to store typed fields + `coaching_notes` jsonb.
4. Strava OAuth + webhook + activity import + historical backfill (multi-user aware)
5. Dashboard: current week, activity feed, weekly mileage chart
6. AI chat: text-based conversation with training context + Brocco personality
7. Health log: quick-add form + AI can log via tool use
8. AI tool use: adjust_plan, modify_plan, log_health, log_activity, query_data, save_profile
9. Plan changes confirmed conversationally (Brocco proposes, user confirms in chat, Brocco applies directly)

**Estimated scope:** 3-4 weekends with Claude Code.

### Phase 2 — Training Plan + Voice
**Goal:** Full plan lifecycle and voice input.

1. AI plan generation via chat ("generate me a marathon plan")
2. Plan view page: calendar layout with phases and color-coded workouts
3. Auto-matching: link activities to planned workouts (timezone-aware)
4. Planned vs. actual comparison on dashboard
5. Voice input via Groq Whisper API (replace Web Speech API): mic button → record → send to Groq → transcribe → text in input box
6. Server endpoint: POST /api/voice/transcribe

**Estimated scope:** 2-3 weekends.

### Phase 3 — Smart Features + Activity Streams Analysis
**Goal:** The AI becomes genuinely insightful by analyzing deep workout data.

**Activity Streams Integration (the big one):**

Strava provides second-by-second time-series data ("streams") for each activity: heart rate, pace, cadence, distance, altitude — one data point per second. This unlocks coaching insights that summary data can't provide.

**Which activities get streams:**
- **Fetch streams for:** tempo, interval, race_pace, long, race — quality sessions where details matter
- **Skip streams for:** easy, recovery, rest, cross_training — summary data is sufficient
- **Also fetch if:** activity looks like a quality session without plan match (high HR variance, very fast pace)
- Result: streams for ~2-3 runs/week per user instead of 5-6

**Which stream types to fetch:**
- `time` — backbone, everything indexes against this
- `heartrate` — cardiac drift, HR zones, recovery between intervals
- `velocity_smooth` — pace consistency, fade, interval splits
- `cadence` — form breakdown under fatigue
- `distance` — mapping pace/HR to distance markers
- `altitude` — only if elevation gain > 50m
- Skip: `latlng` (not useful for coaching), `watts`, `temp`, `grade_smooth`

**Processing pipeline:**
```
Activity arrives via webhook
  → Match to planned workout
  → Quality session? (tempo/interval/long/race/race_pace)
    → YES: fetch streams from Strava API
           → Process into activity_analysis jsonb
           → Optional: quick Claude call to generate key_insights
           → Store analysis on the activity record
           → Discard raw streams (don't store long-term)
    → NO: skip streams, store activity summary only
```

**`activity_analysis` structure (stored on activity record as jsonb):**
```json
{
  "hr_zones": {
    "zone1_pct": 5, "zone2_pct": 62, "zone3_pct": 25, "zone4_pct": 8, "zone5_pct": 0
  },
  "cardiac_drift": {
    "first_half_avg_hr": 148, "second_half_avg_hr": 158,
    "drift_pct": 6.8, "flag": "moderate"
  },
  "pace_analysis": {
    "first_half_avg_pace_secs": 285, "second_half_avg_pace_secs": 298,
    "fade_pct": 4.6,
    "most_consistent_km": 3, "least_consistent_km": 9
  },
  "cadence_analysis": {
    "avg": 176, "first_half_avg": 178, "second_half_avg": 173,
    "drop_under_fatigue": true
  },
  "intervals_detected": [
    {"rep": 1, "distance_m": 800, "time_secs": 192, "avg_hr": 172, "avg_pace_secs": 240},
    {"rep": 2, "distance_m": 800, "time_secs": 195, "avg_hr": 175, "avg_pace_secs": 244},
    {"rep": 3, "distance_m": 800, "time_secs": 201, "avg_hr": 178, "avg_pace_secs": 251}
  ],
  "recovery_between_intervals": [
    {"rest_num": 1, "duration_secs": 90, "hr_at_start": 175, "hr_at_end": 142, "recovery_pct": 19}
  ],
  "key_insights": [
    "Cardiac drift of 6.8% suggests aerobic endurance developing but not yet strong",
    "Pace faded 4.6% in second half — consider more even pacing",
    "Interval reps slowed progressively — target may be too ambitious or rest too short"
  ]
}
```

**How Brocco uses it:**
The context builder includes `activity_analysis` for recent quality sessions (last 14 days). Instead of just seeing "10km at 4:55/km", Brocco sees cardiac drift, pace fade, cadence drop, and pre-generated insights. Enables coaching like: "Your tempo pace faded 4.6% while HR climbed from 148 to 158. That 6.8% cardiac drift tells me your aerobic engine is rebuilding — let's keep tempo at 8km for another week before pushing to 10."

**Cost:** One extra Strava API call per quality session (~2-3/week/user, well within rate limits). Storage: ~1-2KB per activity_analysis. AI cost for insight generation: ~$0.005 per activity if using a quick Claude call, or zero if Brocco analyzes in real-time during chat.

**Other Phase 3 features:**
1. Training load analysis: acute/chronic workload ratio
2. Pace trend detection: "your easy pace has improved 10s/km over 8 weeks"
3. Race predictions: based on recent training data + activity analysis
4. Weekly auto-summary: AI generates a weekly review you can listen to
5. Plan auto-adjustment suggestions: proactive, not just reactive
6. Mobile PWA: add-to-homescreen for phone access

**Estimated scope:** Ongoing iteration.

---

## Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Frontend | Next.js 15 + TypeScript + Tailwind | Same stack as previous projects, reuse knowledge |
| Database | PostgreSQL (via Coolify) | Relational data, free on your server |
| AI | Anthropic API (Claude Opus 4.6) | Best reasoning, tool use support |
| Voice Input | Groq Whisper API (whisper-large-v3-turbo) | Best accuracy, free tier, handles accents/multilingual |
| Strava | Direct API integration | Free, well-documented |
| Auth | Email + password, invite codes | Multi-user without complexity |
| Hosting | Coolify on Hetzner | EU data, same server, already set up |
| Timezone | date-fns-tz | Reliable TZ handling, no custom logic |
| Pace storage | Dual: text for display, int (secs/km) for computation | Avoids parsing strings for analysis |

---

## Compared to Just Using Claude.ai

| Feature | Claude.ai | This App |
|---------|-----------|----------|
| Knows your training history | No, you re-explain each time | Yes, from Strava automatically |
| Sees your actual run data | Only if you paste it | Yes, auto-imported |
| Has your training plan | No | Yes, stored and updated |
| Tracks injuries/health | No | Yes, persistent log |
| Voice interaction | No | Yes |
| Visual dashboard | No | Yes, charts and calendar |
| Suggests plan changes | Generic advice | Specific, data-driven, applies to your plan |
| Available on phone | Yes (but typing is tedious) | Yes, optimized for mobile + voice |
| Remembers your coach | No | Yes, Brocco knows your history |
| Logs manual workouts | You describe them each time | Yes, stored via chat tool |
