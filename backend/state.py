import json
import os
from .models import Table, TableType, TableStatus, PlayMode, Player, Game, RegisteredPlayer

tables: dict[str, Table] = {}
registered_players: dict[str, RegisteredPlayer] = {}


def load_initial_tables() -> None:
    config_path = os.environ.get("TABLES_CONFIG", "/app/tables.json")
    if not os.path.exists(config_path):
        return
    try:
        with open(config_path, encoding="utf-8") as f:
            data = json.load(f)
        for entry in data:
            table = Table(**entry)
            tables[table.id] = table
        print(f"Loaded {len(data)} table(s) from {config_path}")
    except Exception as exc:
        print(f"Warning: failed to load {config_path}: {exc}")


def register_player(name: str) -> RegisteredPlayer:
    player = RegisteredPlayer(name=name)
    registered_players[player.id] = player
    return player


def get_registered_player(player_id: str) -> RegisteredPlayer | None:
    return registered_players.get(player_id)


def unregister_player(player_id: str) -> bool:
    return registered_players.pop(player_id, None) is not None


def list_registered_players() -> list[RegisteredPlayer]:
    return list(registered_players.values())


def update_player_avatar(player_id: str, avatar: str | None) -> None:
    """Persist avatar on the registered player so /players can return it."""
    p = registered_players.get(player_id)
    if p and avatar:
        p.avatar = avatar


def get_table(table_id: str) -> Table | None:
    return tables.get(table_id)


def create_table(table: Table) -> Table:
    tables[table.id] = table
    return table


def delete_table(table_id: str) -> bool:
    return tables.pop(table_id, None) is not None


def _fill_match(table: Table) -> None:
    """Promote queue entries into current_game / opponent slots if empty."""
    if table.current_game is None and table.queue:
        table.current_game = table.queue.pop(0)
    if table.opponent is None and table.queue:
        table.opponent = table.queue.pop(0)
    # Update status
    if table.current_game and table.opponent:
        table.status = TableStatus.playing
    elif table.current_game:
        # One side waiting for an opponent — table stays open
        if table.status != TableStatus.closed:
            table.status = TableStatus.open
    else:
        if table.status != TableStatus.closed:
            table.status = TableStatus.open


def join_queue(table_id: str, game: Game) -> Table | None:
    table = tables.get(table_id)
    if not table:
        return None
    if table.current_game is None:
        table.current_game = game
        if table.opponent:
            table.status = TableStatus.playing
    elif table.opponent is None:
        table.opponent = game
        table.status = TableStatus.playing
    else:
        table.queue.append(game)
    return table


def join_solo_pool(table_id: str, player: Player) -> tuple[Table | None, Game | None]:
    table = tables.get(table_id)
    if not table:
        return None, None
    table.solo_pool.append(player)
    if len(table.solo_pool) >= 2:
        p1 = table.solo_pool.pop(0)
        p2 = table.solo_pool.pop(0)
        game = Game(players=[p1, p2])
        # Route through join_queue to fill match slots properly
        join_queue(table_id, game)
        return table, game
    return table, None


def advance_queue(table_id: str) -> Table | None:
    """Rotation mode: both sides leave, next entries from queue fill in."""
    table = tables.get(table_id)
    if not table:
        return None
    was_closed = table.status == TableStatus.closed
    table.current_game = None
    table.opponent = None
    table.current_wins = 0
    _fill_match(table)
    if was_closed and not table.current_game:
        table.status = TableStatus.closed
    return table


def winner_stays_advance(table_id: str, winner_side: str) -> Table | None:
    """Winner stays mode: winner stays, loser leaves, next from queue becomes opponent."""
    table = tables.get(table_id)
    if not table:
        return None

    if winner_side == "current":
        table.current_wins += 1
        if table.current_wins >= table.max_wins:
            # Winner has reached max consecutive wins, both rotate out
            return advance_queue(table_id)
        # Replace opponent from queue
        table.opponent = table.queue.pop(0) if table.queue else None
    else:
        # Opponent wins — they become current_game
        table.current_game = table.opponent
        table.current_wins = 1
        table.opponent = table.queue.pop(0) if table.queue else None

    if table.current_game and table.opponent:
        table.status = TableStatus.playing
    elif table.current_game:
        if table.status != TableStatus.closed:
            table.status = TableStatus.open
    else:
        if table.status != TableStatus.closed:
            table.status = TableStatus.open
    return table


def remove_from_queue(table_id: str, game_id: str) -> Table | None:
    table = tables.get(table_id)
    if not table:
        return None
    if table.current_game and table.current_game.id == game_id:
        table.current_game = None
        table.current_wins = 0
        _fill_match(table)
    elif table.opponent and table.opponent.id == game_id:
        table.opponent = None
        _fill_match(table)
    else:
        table.queue = [g for g in table.queue if g.id != game_id]
    return table


def move_up_in_queue(table_id: str, game_id: str) -> Table | None:
    table = tables.get(table_id)
    if not table:
        return None
    idx = next((i for i, g in enumerate(table.queue) if g.id == game_id), -1)
    if idx > 0:
        table.queue[idx - 1], table.queue[idx] = table.queue[idx], table.queue[idx - 1]
    return table


def remove_from_solo_pool(table_id: str, player_id: str) -> Table | None:
    table = tables.get(table_id)
    if not table:
        return None
    table.solo_pool = [p for p in table.solo_pool if p.id != player_id]
    return table


def clear_queue(table_id: str) -> Table | None:
    table = tables.get(table_id)
    if not table:
        return None
    was_closed = table.status == TableStatus.closed
    table.queue = []
    table.solo_pool = []
    table.current_game = None
    table.opponent = None
    table.current_wins = 0
    table.status = TableStatus.closed if was_closed else TableStatus.open
    return table
