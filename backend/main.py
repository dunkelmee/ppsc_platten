from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import (
    HTMLResponse, RedirectResponse, StreamingResponse, FileResponse
)
from sse_starlette.sse import EventSourceResponse
import asyncio
import logging
import os
import json
import io
import secrets
from pathlib import Path

logger = logging.getLogger("ppsc")

from .models import (
    Table, TableType, TableStatus, Player, Game,
    JoinRequest, JoinSoloRequest, CreateTableRequest, PatchTableRequest,
    RegisterRequest,
)
from . import state as state_module
from .sse import sse_manager

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")
EVENT_NAME = os.environ.get("EVENT_NAME", "Ping Pong Social Club")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Active session tokens (in-memory; cleared on restart, which is fine for v1)
active_sessions: set[str] = set()

# ── Web Push / VAPID ──────────────────────────────────────────────────────────

_DATA_DIR = Path(os.environ.get("TABLES_CONFIG", "/app/tables.json")).parent
_VAPID_FILE = _DATA_DIR / "vapid_keys.json"
_PUSH_SUBS_FILE = _DATA_DIR / "push_subscriptions.json"


def _init_vapid() -> tuple[str, str]:
    """Return (private_key_pem, public_key_b64url).
    Priority: env vars > persisted file > generate & save to file."""
    priv = os.environ.get("VAPID_PRIVATE_KEY")
    pub  = os.environ.get("VAPID_PUBLIC_KEY")
    if priv and pub:
        return priv, pub
    # Try to load from persisted file
    if _VAPID_FILE.exists():
        try:
            data = json.loads(_VAPID_FILE.read_text())
            logger.info("VAPID keys loaded from %s", _VAPID_FILE)
            return data["private_key"], data["public_key"]
        except Exception as exc:
            logger.warning("Failed to read VAPID keys file: %s", exc)
    # Generate new keys and persist them
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    import base64
    key = ec.generate_private_key(ec.SECP256R1())
    priv_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    pub_bytes = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()
    try:
        _VAPID_FILE.write_text(json.dumps({"private_key": priv_pem, "public_key": pub_b64}))
        logger.info("VAPID keys generated and saved to %s", _VAPID_FILE)
    except Exception as exc:
        logger.warning("Could not persist VAPID keys: %s — set VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY env vars", exc)
    return priv_pem, pub_b64


VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY = _init_vapid()

# push_subscriptions[table_id][game_id] = subscription_json (endpoint + keys)
push_subscriptions: dict[str, dict[str, dict]] = {}


def _load_push_subscriptions() -> None:
    if not _PUSH_SUBS_FILE.exists():
        return
    try:
        data = json.loads(_PUSH_SUBS_FILE.read_text())
        push_subscriptions.update(data)
        total = sum(len(v) for v in push_subscriptions.values())
        logger.info("Loaded %d push subscription(s) from %s", total, _PUSH_SUBS_FILE)
    except Exception as exc:
        logger.warning("Failed to load push subscriptions: %s", exc)


def _save_push_subscriptions() -> None:
    try:
        _PUSH_SUBS_FILE.write_text(json.dumps(push_subscriptions))
    except Exception as exc:
        logger.warning("Failed to save push subscriptions: %s", exc)


async def _push_notify(game_id: str, subscription: dict, payload: dict) -> None:
    """Send a single Web Push notification (runs in a thread to avoid blocking)."""
    from pywebpush import webpush, WebPushException
    endpoint = subscription.get("endpoint", "")[:60]
    logger.info("Push → game=%s endpoint=%s… title=%r", game_id, endpoint, payload.get("title"))
    try:
        await asyncio.to_thread(
            webpush,
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": "mailto:ppsc@ppsc.app"},
        )
        logger.info("Push OK  game=%s", game_id)
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else "no-response"
        if status in (404, 410):
            logger.info("Push subscription expired/gone (game=%s, %s) — removing", game_id, status)
            # Clean up stale subscription
            for subs in push_subscriptions.values():
                subs.pop(game_id, None)
            _save_push_subscriptions()
        else:
            logger.error("Push FAILED game=%s status=%s: %s", game_id, status, exc)
    except Exception as exc:
        logger.error("Push ERROR game=%s: %s", game_id, exc, exc_info=True)


async def _notify_queue_advance(table_id: str) -> None:
    """After a queue advance, push to the new current players and #1-in-queue."""
    table = state_module.get_table(table_id)
    if not table:
        return
    subs = push_subscriptions.get(table_id, {})
    logger.info(
        "notify_advance table=%s stored_subs=%d current=%s queue_len=%d",
        table_id, len(subs),
        table.current_game.id if table.current_game else "none",
        len(table.queue),
    )

    # Notify whoever is now playing ("your turn!") — both sides
    for side in [table.current_game, table.opponent]:
        if side:
            sub = subs.get(side.id)
            if sub:
                asyncio.create_task(_push_notify(side.id, sub, {
                    "title": "🏓 It's your turn!",
                    "body": f"Head to {table.name} — you're on!",
                    "url": f"/table/{table_id}",
                }))
            else:
                logger.info("No push sub for game %s", side.id)

    # Notify whoever is now #1 in queue ("get ready")
    if table.queue:
        sub = subs.get(table.queue[0].id)
        if sub:
            asyncio.create_task(_push_notify(table.queue[0].id, sub, {
                "title": "⏳ You're up next!",
                "body": f"One game left before you at {table.name}.",
                "url": f"/table/{table_id}",
            }))
        else:
            logger.info("No push sub for queue[0] %s", table.queue[0].id)


# ── Auth ──────────────────────────────────────────────────────────────────────

def _is_admin(request: Request) -> bool:
    session = request.cookies.get("admin_session")
    if session and session in active_sessions:
        return True
    if request.headers.get("X-Admin-Key") == ADMIN_PASSWORD:
        return True
    # Query-param fallback for EventSource (can't set headers)
    if request.query_params.get("key") == ADMIN_PASSWORD:
        return True
    return False


def require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    state_module.load_initial_tables()
    _load_push_subscriptions()
    yield


app = FastAPI(title="PPSC Queue", lifespan=lifespan)

# ── Static file mounts ────────────────────────────────────────────────────────

if (FRONTEND_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
if (FRONTEND_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")


def _html(filename: str) -> HTMLResponse:
    return HTMLResponse((FRONTEND_DIR / filename).read_text(encoding="utf-8"))


# ── SSE broadcast helper ──────────────────────────────────────────────────────

async def _broadcast(table_id: str) -> None:
    table = state_module.get_table(table_id)
    if table:
        await sse_manager.broadcast(f"table:{table_id}", table.model_dump_json())
    all_tables = {tid: t.model_dump(mode="json") for tid, t in state_module.tables.items()}
    await sse_manager.broadcast("admin", json.dumps(all_tables))


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def index():
    return _html("index.html")


@app.get("/sw.js")
async def service_worker():
    path = FRONTEND_DIR / "sw.js"
    return FileResponse(str(path), media_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/"})


@app.get("/push/vapid-public-key")
async def vapid_public_key():
    return {"public_key": VAPID_PUBLIC_KEY}


@app.post("/table/{table_id}/push-subscribe")
async def push_subscribe(table_id: str, request: Request):
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    body = await request.json()
    game_id = body.get("game_id")
    subscription = body.get("subscription")
    if not game_id or not subscription:
        raise HTTPException(400, "game_id and subscription are required")
    push_subscriptions.setdefault(table_id, {})[game_id] = subscription
    total = sum(len(v) for v in push_subscriptions.values())
    logger.info("Push sub stored: table=%s game=%s (total stored=%d)", table_id, game_id, total)
    _save_push_subscriptions()
    return {"status": "ok"}


@app.post("/admin/tables/{table_id}/test-push/{game_id}")
async def admin_test_push(table_id: str, game_id: str, request: Request):
    """Send a test push to a specific game_id — useful for debugging."""
    require_admin(request)
    sub = push_subscriptions.get(table_id, {}).get(game_id)
    if not sub:
        raise HTTPException(404, f"No push subscription found for game {game_id} on table {table_id}. "
                                 "Stored subs: " + str({t: list(g.keys()) for t, g in push_subscriptions.items()}))
    await _push_notify(game_id, sub, {
        "title": "🏓 Test notification",
        "body": "Push notifications are working!",
        "url": f"/table/{table_id}",
    })
    return {"status": "sent"}


@app.get("/logo.png")
async def logo():
    for candidate in [Path("logo.png"), Path(__file__).parent.parent / "logo.png"]:
        if candidate.exists():
            return FileResponse(str(candidate), media_type="image/png")
    raise HTTPException(404, "Logo not found")


# ── Registration ──────────────────────────────────────────────────────────────

@app.get("/register", response_class=HTMLResponse)
async def register_page():
    return _html("register.html")


@app.post("/register")
async def register_player(body: RegisterRequest):
    player = state_module.register_player(body.name)
    return {"player_id": player.id, "name": player.name}


@app.post("/logout")
async def player_logout(request: Request):
    body = await request.json()
    player_id = body.get("player_id")
    if player_id:
        state_module.unregister_player(player_id)
    return {"status": "ok"}


@app.get("/register/check/{player_id}")
async def check_registration(player_id: str):
    player = state_module.get_registered_player(player_id)
    if player:
        return {"valid": True, "name": player.name}
    return {"valid": False, "name": None}


@app.get("/players")
async def list_players():
    return [{"id": p.id, "name": p.name} for p in state_module.list_registered_players()]


@app.get("/table/{table_id}", response_class=HTMLResponse)
async def table_page(table_id: str):
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    return _html("table.html")


@app.get("/table/{table_id}/state")
async def table_state(table_id: str):
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    return table.model_dump()


@app.get("/table/{table_id}/stream")
async def table_stream(table_id: str, request: Request):
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    channel = f"table:{table_id}"
    q = sse_manager.subscribe(channel)

    async def generator():
        table = state_module.get_table(table_id)
        if table:
            yield {"data": table.model_dump_json()}
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield {"data": data}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            sse_manager.unsubscribe(channel, q)

    return EventSourceResponse(generator())


@app.post("/table/{table_id}/join")
async def join_queue(table_id: str, body: JoinRequest):
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if table.status == TableStatus.closed:
        raise HTTPException(409, "Table is closed")

    player1 = Player(nickname=body.nickname, skill=body.skill, registered_id=body.player_id)

    if table.type == TableType.singles:
        game = Game(players=[player1])
    else:
        if not body.partner_nickname or not body.partner_skill:
            raise HTTPException(400, "Partner details required for doubles pair join")
        player2 = Player(nickname=body.partner_nickname, skill=body.partner_skill, registered_id=body.partner_player_id)
        game = Game(players=[player1, player2])

    updated = state_module.join_queue(table_id, game)
    await _broadcast(table_id)

    # Position: 0 = now playing (current_game or opponent), 1+ = queue position
    if updated and (
        (updated.current_game and updated.current_game.id == game.id) or
        (updated.opponent and updated.opponent.id == game.id)
    ):
        position = 0
    else:
        position = len(updated.queue) if updated else 1

    return {"game_id": game.id, "position": position}


@app.post("/table/{table_id}/join-solo")
async def join_solo(table_id: str, body: JoinSoloRequest):
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if table.type != TableType.doubles:
        raise HTTPException(400, "Solo join is only available on doubles tables")
    if table.status == TableStatus.closed:
        raise HTTPException(409, "Table is closed")

    player = Player(nickname=body.nickname, skill=body.skill, registered_id=body.player_id)
    _, paired_game = state_module.join_solo_pool(table_id, player)
    await _broadcast(table_id)

    if paired_game:
        other = next(p for p in paired_game.players if p.id != player.id)
        return {
            "status": "paired",
            "game_id": paired_game.id,
            "paired_with": other.nickname,
            "player_id": player.id,
        }
    return {"status": "waiting", "player_id": player.id}


@app.post("/table/{table_id}/done")
async def game_done(table_id: str):
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if not table.current_game:
        raise HTTPException(400, "No active game to end")
    state_module.advance_queue(table_id)
    await _broadcast(table_id)
    await _notify_queue_advance(table_id)
    return {"status": "ok"}


@app.post("/table/{table_id}/winner")
async def declare_winner(table_id: str, request: Request):
    body = await request.json()
    winner_side = body.get("winner_side")
    if winner_side not in ("current", "opponent"):
        raise HTTPException(400, "winner_side must be 'current' or 'opponent'")
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if not table.current_game or not table.opponent:
        raise HTTPException(400, "No active match")
    state_module.winner_stays_advance(table_id, winner_side)
    await _broadcast(table_id)
    await _notify_queue_advance(table_id)
    return {"status": "ok"}


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN AUTH
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login_page():
    return _html("admin_login.html")


@app.post("/admin/login")
async def admin_login(request: Request):
    form = await request.form()
    password = str(form.get("password", ""))
    if password == ADMIN_PASSWORD:
        token = secrets.token_urlsafe(32)
        active_sessions.add(token)
        resp = RedirectResponse(url="/admin", status_code=303)
        resp.set_cookie("admin_session", token, httponly=True, samesite="lax", max_age=86400)
        return resp
    raw = (FRONTEND_DIR / "admin_login.html").read_text(encoding="utf-8")
    return HTMLResponse(
        raw.replace("<!-- ERROR_PLACEHOLDER -->",
                    '<p class="login-error">Incorrect password. Please try again.</p>'),
        status_code=401,
    )


@app.get("/admin/logout")
async def admin_logout(request: Request):
    session = request.cookies.get("admin_session")
    if session:
        active_sessions.discard(session)
    resp = RedirectResponse(url="/admin/login", status_code=303)
    resp.delete_cookie("admin_session")
    return resp


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return _html("admin.html")


@app.get("/admin/state")
async def admin_state(request: Request):
    require_admin(request)
    return {tid: t.model_dump() for tid, t in state_module.tables.items()}


@app.get("/admin/stream")
async def admin_stream(request: Request):
    require_admin(request)
    q = sse_manager.subscribe("admin")

    async def generator():
        all_tables = {tid: t.model_dump(mode="json") for tid, t in state_module.tables.items()}
        yield {"data": json.dumps(all_tables)}
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield {"data": data}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            sse_manager.unsubscribe("admin", q)

    return EventSourceResponse(generator())


@app.get("/admin/qr", response_class=HTMLResponse)
async def admin_qr_page(request: Request):
    require_admin(request)
    return _html("admin_qr.html")


@app.get("/admin/qr/register")
async def admin_qr_register(request: Request):
    require_admin(request)
    import qrcode
    url = f"{BASE_URL}/register"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": 'inline; filename="register-qr.png"'},
    )


@app.get("/admin/qr/{table_id}")
async def admin_qr_image(table_id: str, request: Request):
    require_admin(request)
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    import qrcode
    url = f"{BASE_URL}/table/{table_id}"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="{table_id}-qr.png"'},
    )


# ── Admin: table CRUD ─────────────────────────────────────────────────────────

@app.post("/admin/tables", status_code=201)
async def create_table(body: CreateTableRequest, request: Request):
    require_admin(request)
    if state_module.get_table(body.id):
        raise HTTPException(409, f"Table '{body.id}' already exists")
    table = Table(id=body.id, name=body.name, type=body.type,
                  play_mode=body.play_mode, max_wins=body.max_wins)
    state_module.create_table(table)
    await _broadcast(body.id)
    return table.model_dump()


@app.patch("/admin/tables/{table_id}")
async def patch_table(table_id: str, body: PatchTableRequest, request: Request):
    require_admin(request)
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if body.name is not None:
        table.name = body.name
    if body.status is not None:
        table.status = body.status
    await _broadcast(table_id)
    return table.model_dump()


@app.delete("/admin/tables/{table_id}", status_code=204)
async def delete_table(table_id: str, request: Request):
    require_admin(request)
    if not state_module.delete_table(table_id):
        raise HTTPException(404, "Table not found")
    all_tables = {tid: t.model_dump(mode="json") for tid, t in state_module.tables.items()}
    await sse_manager.broadcast("admin", json.dumps(all_tables))


# ── Admin: queue actions ──────────────────────────────────────────────────────

@app.post("/admin/tables/{table_id}/advance")
async def admin_advance(table_id: str, request: Request):
    require_admin(request)
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    state_module.advance_queue(table_id)
    await _broadcast(table_id)
    await _notify_queue_advance(table_id)
    return {"status": "ok"}


@app.post("/admin/tables/{table_id}/clear")
async def admin_clear(table_id: str, request: Request):
    require_admin(request)
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    state_module.clear_queue(table_id)
    await _broadcast(table_id)
    return {"status": "ok"}


@app.post("/admin/tables/{table_id}/close")
async def admin_close(table_id: str, request: Request):
    require_admin(request)
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    table.status = TableStatus.closed
    await _broadcast(table_id)
    return {"status": "ok"}


@app.post("/admin/tables/{table_id}/open")
async def admin_open(table_id: str, request: Request):
    require_admin(request)
    table = state_module.get_table(table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    if table.current_game and table.opponent:
        table.status = TableStatus.playing
    else:
        table.status = TableStatus.open
    await _broadcast(table_id)
    return {"status": "ok"}


@app.delete("/admin/tables/{table_id}/queue/{game_id}")
async def admin_remove_game(table_id: str, game_id: str, request: Request):
    require_admin(request)
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    state_module.remove_from_queue(table_id, game_id)
    await _broadcast(table_id)
    return {"status": "ok"}


@app.post("/admin/tables/{table_id}/queue/{game_id}/move-up")
async def admin_move_up(table_id: str, game_id: str, request: Request):
    require_admin(request)
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    state_module.move_up_in_queue(table_id, game_id)
    await _broadcast(table_id)
    return {"status": "ok"}


@app.delete("/admin/tables/{table_id}/solo/{player_id}")
async def admin_remove_solo(table_id: str, player_id: str, request: Request):
    require_admin(request)
    if not state_module.get_table(table_id):
        raise HTTPException(404, "Table not found")
    state_module.remove_from_solo_pool(table_id, player_id)
    await _broadcast(table_id)
    return {"status": "ok"}
