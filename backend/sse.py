import asyncio
from collections import defaultdict
from typing import DefaultDict


class SSEManager:
    """Manages per-channel asyncio queues for Server-Sent Events broadcasting."""

    def __init__(self) -> None:
        self._queues: DefaultDict[str, list[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._queues[channel].append(q)
        return q

    def unsubscribe(self, channel: str, q: asyncio.Queue) -> None:
        try:
            self._queues[channel].remove(q)
        except ValueError:
            pass

    async def broadcast(self, channel: str, data: str) -> None:
        dead: list[asyncio.Queue] = []
        for q in list(self._queues[channel]):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(channel, q)


sse_manager = SSEManager()
