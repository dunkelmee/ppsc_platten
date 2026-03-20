# Ping Pong Social Club — Technical Infrastructure Specifications

## 1. Architecture Overview

A three-tier web application:

```
Browser (mobile)
     │  HTTP / SSE
     ▼
FastAPI (Python)  ◄──►  In-memory state (Python dicts)
     │
     │  static files
     ▼
Frontend (Vanilla JS + HTML/CSS)
```

All three components run inside a single Docker container for v1. No external database, no message broker, no cloud dependencies — the entire app is one `docker run` command.

---

## 2. Component Breakdown

### 2.1 Backend — Python / FastAPI

**Why FastAPI:**
- Native async support, which pairs well with SSE (Server-Sent Events)
- Automatic OpenAPI docs out of the box (useful for debugging during development)
- Lightweight and fast to stand up
- Pydantic models for request/response validation with minimal boilerplate

**Key responsibilities:**
- Serve the frontend static files
- Expose REST endpoints for all queue actions (join, leave, advance, clear)
- Expose SSE endpoints for real-time queue state streaming to browsers
- Hold all event state in memory (Python dicts, no ORM needed)
- Validate and sanitise all inputs

### 2.2 Frontend — Vanilla JS

**Why no framework:**
- The app is loaded via QR scan on a phone; minimal JS bundle = faster first load
- The UI is simple enough that React/Vue would be overhead, not help
- No build step needed; FastAPI serves the files directly

**Key responsibilities:**
- Render the queue page for a given table
- Connect to the SSE stream and re-render on each event
- Submit sign-up and game-done actions via `fetch()` calls to the API
- Render the admin dashboard

### 2.3 Real-time Layer — Server-Sent Events (SSE)

**Why SSE over WebSockets:**
- SSE is one-directional (server → client), which matches the use case: clients submit actions via REST, server pushes state updates
- SSE is simpler to implement and requires no special proxy configuration
- Works natively in all modern mobile browsers with no library needed
- Reconnects automatically on connection drop

**SSE event model:**
- One SSE stream per table: `GET /table/{table_id}/stream`
- One SSE stream for the admin dashboard: `GET /admin/stream`
- On any state change to a table, the server broadcasts the full updated table state as a JSON payload to all connected clients on that table's stream
- Clients replace their local state entirely on each event (no delta patching in v1)

---

## 3. Project Structure

```
ppsc/
├── backend/
│   ├── main.py              # FastAPI app, route definitions
│   ├── models.py            # Pydantic models (Player, Queue, Table, etc.)
│   ├── state.py             # In-memory state store and mutation functions
│   ├── sse.py               # SSE connection manager and broadcaster
│   └── requirements.txt
├── frontend/
│   ├── index.html           # Entry point (redirects or shows table selector)
│   ├── table.html           # Queue page (loaded via QR scan)
│   ├── admin.html           # Admin dashboard
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── table.js         # Queue page logic
│       └── admin.js         # Admin dashboard logic
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 4. Data Models

### Table
```python
class TableType(str, Enum):
    singles = "singles"
    doubles = "doubles"

class TableStatus(str, Enum):
    open = "open"
    playing = "playing"
    closed = "closed"

class Table(BaseModel):
    id: str                      # e.g. "singles-1"
    name: str                    # e.g. "Table 1"
    type: TableType
    status: TableStatus
    current_game: Game | None
    queue: list[Game]            # ordered list of upcoming games
    solo_pool: list[Player]      # doubles tables only
```

### Player
```python
class SkillLevel(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"

class Player(BaseModel):
    nickname: str                # max 20 chars
    skill: SkillLevel
    joined_at: datetime
```

### Game
```python
class Game(BaseModel):
    id: str                      # uuid4
    players: list[Player]        # 1 player (singles) or 2 players (doubles)
    queued_at: datetime
```

---

## 5. API Endpoints

### Public (player-facing)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/table/{table_id}` | Serve table queue HTML page |
| `GET` | `/table/{table_id}/state` | Get current queue state as JSON |
| `GET` | `/table/{table_id}/stream` | SSE stream for live queue updates |
| `POST` | `/table/{table_id}/join` | Join the queue (singles or doubles pair) |
| `POST` | `/table/{table_id}/join-solo` | Join the solo waiting pool (doubles) |
| `POST` | `/table/{table_id}/done` | Mark current game as done, advance queue |

### Admin (host-facing)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin` | Serve admin dashboard HTML |
| `GET` | `/admin/state` | Get all tables state as JSON |
| `GET` | `/admin/stream` | SSE stream for all table updates |
| `POST` | `/admin/tables` | Create a new table |
| `PATCH` | `/admin/tables/{table_id}` | Update table (rename, change status) |
| `DELETE` | `/admin/tables/{table_id}/queue/{game_id}` | Remove a specific entry from queue |
| `POST` | `/admin/tables/{table_id}/advance` | Force-advance the queue |
| `POST` | `/admin/tables/{table_id}/clear` | Clear entire queue |
| `POST` | `/admin/tables/{table_id}/close` | Mark table as closed |
| `GET` | `/admin/qr` | Serve QR code generator page |

### Auth
Admin endpoints are protected by a shared secret passed as a request header (`X-Admin-Key`) or as a session cookie after a simple password login page. No JWT, no OAuth — a single env-var password is sufficient for v1.

---

## 6. State Management

All state lives in a single Python module (`state.py`) as a dict keyed by table ID. FastAPI is async but runs on a single process in v1, so no locking is needed. If multi-worker deployments become necessary later, state can be migrated to Redis with minimal changes.

```python
# state.py (simplified)
from collections import defaultdict

tables: dict[str, Table] = {}       # keyed by table_id
listeners: dict[str, list] = defaultdict(list)  # SSE queues per table_id
```

State is initialised from an optional `tables.json` config file at startup (for pre-seeding table names and types), otherwise tables are created via the admin API.

---

## 7. Docker Setup

### Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Single-stage build. No Nginx needed — FastAPI/Uvicorn serves the static frontend files directly via `StaticFiles` mount.

### docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - EVENT_NAME=${EVENT_NAME:-Ping Pong Social Club}
    volumes:
      - ./tables.json:/app/tables.json:ro   # optional table pre-config
    restart: unless-stopped
```

### .env.example

```
ADMIN_PASSWORD=changeme
EVENT_NAME=Ping Pong Social Club
```

---

## 8. Requirements

### backend/requirements.txt

```
fastapi==0.115.0
uvicorn[standard]==0.30.0
pydantic==2.8.0
python-multipart==0.0.9
sse-starlette==2.1.0
qrcode[pil]==7.4.2
```

Notable: `sse-starlette` handles the SSE response boilerplate cleanly within FastAPI. `qrcode` generates QR code images server-side for the admin setup page.

---

## 9. Deployment

### Local development
```bash
docker compose up --build
# App available at http://localhost:8000
# Admin at http://localhost:8000/admin
```

### Production (single VPS or PaaS)
The app is stateless-ish (in-memory only) so any single-instance hosting works:

| Option | Notes |
|--------|-------|
| **Fly.io** | Free tier sufficient; `fly launch` handles Docker deploy |
| **Render** | Simple Docker deploy; free tier has cold starts (acceptable for events) |
| **Railway** | Straightforward Docker support; generous free tier |
| **Any VPS** | `docker compose up -d` behind Caddy or Nginx for HTTPS |

HTTPS is required for QR code scanning on iOS Safari (camera API needs a secure context). Use Let's Encrypt via Caddy or the PaaS provider's automatic TLS.

### Pre-event checklist
1. Deploy app and confirm HTTPS is working
2. Create tables via admin panel (or pre-seed `tables.json`)
3. Print QR codes from `/admin/qr`
4. Share admin URL + password with the host
5. At end of event: restart container or hit "clear all" in admin to reset state

---

## 10. Scalability Notes (for future reference)

The v1 design deliberately trades scalability for simplicity. If the app grows:

| Concern | v1 approach | Future path |
|---------|------------|-------------|
| Multi-worker | Single Uvicorn worker | Add Redis for shared state + pub/sub for SSE fanout |
| Persistence between events | None (in-memory) | PostgreSQL + SQLAlchemy, event history per date |
| Multiple simultaneous events | Not supported | Multi-tenancy via event codes in URL |
| Push notifications | Not supported | Web Push API + service worker |

None of these are needed for a social club running 1–2 events per week with 50–200 people.

---

## 11. Security Considerations

- No personal data collected — minimal privacy surface
- Admin endpoint protected by shared secret (env var)
- All inputs validated and length-capped by Pydantic
- No SQL — no injection risk
- Rate limiting on join endpoints recommended (e.g. max 1 join per IP per 10 seconds) to prevent queue spam — can be added with `slowapi` in v1
- HTTPS enforced in production for secure QR scanning