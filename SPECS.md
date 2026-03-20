# Ping Pong Social Club — Queue App Specifications

## 1. Overview

A lightweight, no-install web app that helps organise table queues at social table tennis events. Players scan a QR code on a table, enter a nickname and skill level, and join that table's queue. No accounts, no passwords, no app download required.

---

## 2. Scope

### In scope
- Singles table queuing (individual sign-up, paired when table is free)
- Doubles table queuing (pre-formed pair sign-up OR solo sign-up with auto-pairing)
- QR code per table linking directly to that table's queue page
- Live queue view visible to all players on their phone
- "Game done" action to advance the queue
- Admin/host view to manage all tables from one screen

### Out of scope (v1)
- Rundlauf tables (self-organising, no app needed)
- User accounts or persistent profiles
- Push notifications (players check the live queue themselves)
- Skill-based matchmaking beyond the self-reported colour label
- Payment or registration flows

---

## 3. Table Types

| Type | Sign-up unit | Queue behaviour |
|------|-------------|-----------------|
| Singles | Individual | FIFO; top 2 in queue are called to play when table is free |
| Doubles | Pair or Individual | Two lanes: pre-formed pairs join the main queue directly; solo sign-ups enter a waiting pool and are auto-paired when two solos are present, then join the main queue |

---

## 4. Player Data

Only the minimum necessary data is collected per sign-up:

| Field | Type | Notes |
|-------|------|-------|
| Nickname | Free text | Required; max 20 characters; no account needed |
| Skill level | Enum | Beginner / Intermediate / Advanced; self-reported |
| Partner nickname | Free text | Doubles pre-formed pairs only; optional second nickname |
| Sign-up timestamp | Auto | Used for FIFO ordering |
| Table ID | Auto | Derived from QR code URL |

No personal data (email, phone, real name) is collected. Data lives only for the duration of the event and is cleared afterwards.

---

## 5. Skill Levels

Self-reported, no enforcement. Displayed as a colour badge throughout the UI.

| Label | Colour | Intended for |
|-------|--------|--------------|
| Beginner | Green | New to table tennis or very casual |
| Intermediate | Amber | Regular recreational player |
| Advanced | Red | Competitive club-level player |

---

## 6. User Flows

### 6.1 Player — Joining a singles queue

1. Player scans QR code on the table → browser opens queue page for that table
2. Page shows: table name/number, current queue, and a sign-up form
3. Player enters nickname and selects skill level
4. Player taps **Join queue**
5. Player is added to the bottom of the queue; page updates live
6. When the player reaches position 1 or 2, the page shows a highlighted "You're up next" indicator (position awareness is their responsibility — no push notification)

### 6.2 Player — Joining a doubles queue (pre-formed pair)

1. Same QR scan flow as above
2. Player selects **I have a partner**
3. Player enters own nickname, partner's nickname, and both skill levels
4. Pair joins the main doubles queue as a unit

### 6.3 Player — Joining a doubles queue (solo)

1. Same QR scan flow as above
2. Player selects **I need a partner**
3. Player enters own nickname and skill level
4. Player enters the **solo waiting pool** (separate from the main queue)
5. When a second solo joins the pool, the two are automatically paired and move to the bottom of the main doubles queue
6. Both players see a small notification on the page: "You've been paired with [nickname]!"

### 6.4 Advancing the queue ("Game done")

1. When a game finishes, either player taps **Game done** on the queue page
2. The current pair/game is removed from the top of the queue
3. The next pair/game is promoted and highlighted as "Now playing"
4. If the queue is empty, the table shows an "Open — join the queue!" state

### 6.5 Host/Admin — Managing all tables

1. Host opens the admin URL (separate, not linked from QR codes)
2. Admin view shows all tables in a grid: table name, type, current players, queue length, solo pool size (for doubles tables)
3. Host can manually:
   - Remove a player/pair from any queue (e.g. they left)
   - Advance the queue (same as "Game done")
   - Clear a full queue (e.g. event is ending)
   - Mark a table as closed/out of service

---

## 7. QR Code System

- Each physical table gets one QR code (printed sticker)
- QR code encodes a URL of the form: `https://[domain]/table/[table-id]`
- `table-id` is a short, human-readable slug, e.g. `singles-1`, `doubles-2`
- Table type (singles vs doubles) is configured in the admin panel and stored server-side — the QR code itself carries no type information
- QR codes are generated once during event setup and do not change between events

---

## 8. Real-Time Behaviour

- All queue pages update live without manual refresh
- Technology: WebSockets or Server-Sent Events (SSE preferred for simplicity)
- Latency target: queue updates visible to all viewers within 2 seconds of an action

---

## 9. UI Pages

| Page | URL pattern | Who uses it |
|------|-------------|-------------|
| Table queue page | `/table/[table-id]` | Players (via QR scan) |
| Admin dashboard | `/admin` | Event host |
| QR code generator | `/admin/qr` | Event host (setup only) |

### Table queue page must show:
- Table name and type (Singles / Doubles)
- Current game: nickname(s) and skill badge(s) of who is currently playing
- Queue list: ordered list of pairs/individuals waiting, with position number and skill badges
- Solo pool (doubles tables only): how many solos are waiting and for whom
- Sign-up form (always visible at the bottom)
- "Game done" button (visible to all; honor system)

### Admin dashboard must show:
- All tables in a card grid
- Per table: type, status (playing / waiting / open / closed), queue depth, current players
- Per-entry actions: remove player, move up in queue
- Per-table actions: advance queue, clear queue, toggle open/closed

---

## 10. Edge Cases to Handle

| Scenario | Handling |
|----------|----------|
| Player joins queue but leaves without playing | Host removes them manually via admin panel; no automatic timeout in v1 |
| Same nickname submitted twice on the same table | Allow it — nicknames are not unique identifiers; position in queue is what matters |
| Only one solo is in the doubles waiting pool when the main queue empties | Solo stays in the pool; table shows "1 player waiting for a partner" |
| "Game done" tapped when queue is empty | No action; button is disabled or greyed out when queue has fewer than one entry |
| Table is marked closed mid-event | Queue page shows a "Table closed" banner; sign-up form is hidden |
| Admin clears a queue with players still in it | Confirmation prompt required before clearing |

---

## 11. Technical Assumptions

- Web app only; no native app
- Runs in any modern mobile browser (Safari iOS, Chrome Android) — no install required
- State is held server-side; clients are thin viewers
- No database persistence between events required in v1 — in-memory state is acceptable, cleared on server restart
- Admin panel is access-controlled by a simple password or secret URL (no full auth system in v1)
- Hosting: any Node.js-capable platform (e.g. Railway, Render, Fly.io)

---

## 12. Open Questions

1. **How many tables** are typically in use at an event? This affects admin layout decisions.
2. **Does the host want to name tables** (e.g. "Table 1", "Red Table") or use auto-generated slugs?
3. **Solo pairing logic for doubles** — should the app try to match similar skill levels when possible, or is pure FIFO order good enough?
4. **"Game done" trust model** — is it fine for any player to tap this (honor system), or does the host want to be the only one who can advance the queue?
5. **Event duration and reset** — does the app need a one-tap "reset all queues" action for when a new event starts, or is a server restart acceptable?
6. **Languages** — should the UI support German and English, or English only for v1?