# Personal AI Running Coach — Concept Document

## Overview

A web app that acts as a personal AI running coach. It pulls training data automatically from Strava, maintains a periodized training plan, and provides coaching advice through a voice-enabled chat interface powered by Claude. Think of it as having a knowledgeable running coach on call 24/7 who already knows your entire training history.

**Domain:** brocco.run — "Run like a broccoli."
**Hosted on:** Hetzner server via Coolify (EU-based)
**Tech stack:** Next.js 15, PostgreSQL, Strava API, Anthropic API (Claude), Web Speech API
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

These change the shape of the training block and are shown as pending changes in the chat UI for the user to approve or reject.

### 3. Voice Interface

**Speech-to-text (your input):**
- Uses the Web Speech API (built into Chrome/Safari, free)
- Press a microphone button or use a keyboard shortcut to start listening
- Your speech is transcribed to text and sent as a chat message
- Works well for simple coaching questions, especially on mobile

**Text-to-speech (AI response):**
- Option 1: Browser's built-in SpeechSynthesis API (free, sounds robotic but works)
- Option 2: ElevenLabs API (much more natural, small cost per request)
- Toggle: you can choose voice on/off per message or globally
- Ideal for post-run when you're stretching and don't want to read a screen

**Practical consideration:** Voice is a nice-to-have layer on top of text chat. The app should work perfectly as text-only. Voice is the convenience feature, not the core.

### 4. Training Plan

A structured training plan that the AI generates and you can modify together through conversation.

**Plan structure:**
```
Goal: Barcelona Marathon, October 2026, Sub-3:30
  └── Phase: Base Building (Weeks 1-8)
       └── Week 1: 45km target
            └── Mon: Rest
            └── Tue: Easy 8km @ 5:45-6:00/km
            └── Wed: Intervals 10km (6x800m @ 3:50)
            └── Thu: Easy 6km @ 5:45-6:00/km
            └── Fri: Rest
            └── Sat: Easy 10km @ 5:30-5:45/km
            └── Sun: Long 18km @ 5:30-5:45/km
```

**How plans are created:**
- You tell the AI your goal: "I want to run sub-3:30 at Barcelona Marathon in October"
- The AI generates a full periodized plan (base → build → peak → taper)
- You review it, discuss adjustments ("I can't run on Wednesdays", "I want to include cycling")
- Once confirmed, the plan is saved to the database

**How plans adapt:**
- When a new activity comes in, Brocco automatically adjusts the current week's remaining sessions to account for what actually happened (micro-adjustments: distance, pace, rest day shifts)
- If your paces are improving, Brocco can suggest updating targets (requires confirmation)
- If you report an injury, Brocco suggests modified training (requires confirmation for structural changes, auto-applies conservative reductions within the week)
- Weekly mileage targets and phase structure are guardrails — Brocco works within them for auto-adjustments but asks before changing them

**Auto-adjustment flow:**
When Brocco auto-applies a micro-adjustment, it is logged in `plan_adjustment_log` with a reason and the before/after state. The dashboard shows a notification with an undo button. No chat interaction required — this happens automatically when activities are imported.

**Pending changes flow (structural):**
When Brocco proposes structural modifications (via chat), they are stored as pending changes linked to the chat message. The user sees a confirmation card in the chat UI. Pending changes expire after 24 hours if not acted on.

**Plan storage:**
- Plans are stored as structured data (phases, weeks, workouts) in PostgreSQL
- Each workout has: date, type, target distance, target pace, target duration, description, status (planned/completed/skipped/modified)
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
| Onboarding | /onboarding | First-time setup: profile, goals, Strava connect |
| Dashboard | / | Training week, mileage chart, metrics, activity feed |
| Chat | /chat | AI coach conversation with voice support |
| Plan | /plan | Full training plan view (phases, weeks, workouts) |
| History | /history | All past activities with search/filter |
| Settings | /settings | Profile, goals, Strava connection, AI preferences |

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
| status | enum | 'planned', 'completed', 'skipped', 'modified' |
| matched_activity_id | uuid | nullable, FK → activities, auto-linked |
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

**pending_plan_changes** (structural changes — require user confirmation)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users |
| chat_message_id | uuid | FK → chat_messages — which message proposed this |
| changes | jsonb | the full modify_plan tool call payload |
| summary | text | human-readable summary of all changes |
| status | enum | 'pending', 'approved', 'rejected', 'expired' |
| created_at | timestamp | |
| resolved_at | timestamp | nullable |
| expires_at | timestamp | default: created_at + 24 hours |

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
10. Rate-limit the webhook endpoint (reject if > 100 requests/minute)

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

Five tools available to Claude during chat:

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

### Model Selection
- Use `claude-sonnet-4-20250514` for most interactions (fast, capable, cost-effective)
- Consider `claude-opus-4-6` for complex plan generation or detailed race analysis
- Model is configurable per user in settings (stored in ai_preferences)

### Cost Estimate
- Average coaching interaction: ~2000 input tokens (context) + ~500 output tokens
- At Sonnet pricing: roughly $0.01-0.02 per interaction
- 5-10 interactions per day per user = $0.05-0.20/day per user
- With 5 friends: ~$15-30/month total — very manageable

---

## Voice Interface — Technical Details

### Speech-to-Text (Input)
- Use the Web Speech API (`SpeechRecognition` interface)
- Supported in Chrome, Edge, Safari (not Firefox)
- Free, runs in the browser, no API costs
- Language: English (or German, configurable per user in ai_preferences)
- UI: microphone button that toggles recording, with visual feedback (pulsing dot)

### Text-to-Speech (Output)
**Option A: Browser SpeechSynthesis (free, basic)**
- Built into all modern browsers
- Sounds robotic but functional
- Zero cost, zero latency
- Good enough for v1

**Option B: ElevenLabs API (natural, paid)**
- Very natural-sounding voices
- ~$5/month for personal use tier
- Could give Brocco a distinctive voice (stretch goal)
- Add as optional upgrade later

**Implementation:**
- Default: text-only
- Toggle button to enable voice output
- Auto-play voice response when voice mode is on
- Stop button to interrupt playback
- Voice mode preference stored per user

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
3. Onboarding flow: profile, goals, timezone, Brocco intro
4. Strava OAuth + webhook + activity import + historical backfill (multi-user aware)
5. Dashboard: current week, activity feed, weekly mileage chart
6. AI chat: text-based conversation with training context + Brocco personality
7. Health log: quick-add form + AI can log via tool use
8. AI tool use: adjust_plan, modify_plan, log_health, log_activity, query_data
9. Pending changes: store, display, confirm/reject UI

**Estimated scope:** 3-4 weekends with Claude Code.

### Phase 2 — Training Plan + Voice
**Goal:** Full plan lifecycle and hands-free interaction.

1. AI plan generation via chat ("generate me a marathon plan")
2. Plan view page: calendar layout with phases and color-coded workouts
3. Auto-matching: link activities to planned workouts (timezone-aware)
4. Planned vs. actual comparison on dashboard
5. Speech-to-text input (Web Speech API)
6. Text-to-speech output (browser built-in)
7. Voice recording indicator + auto-play toggle

**Estimated scope:** 2-3 weekends.

### Phase 3 — Smart Features
**Goal:** The AI becomes genuinely insightful.

1. Training load analysis: acute/chronic workload ratio
2. Pace trend detection: "your easy pace has improved 10s/km over 8 weeks"
3. Race predictions: based on recent training data
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
| AI | Anthropic API (Claude Sonnet 4) | Best reasoning, tool use support |
| Voice Input | Web Speech API | Free, browser-native, good enough |
| Voice Output | Browser SpeechSynthesis (v1) | Free, upgrade to ElevenLabs later |
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
