from __future__ import annotations

import threading
import time
from collections import deque


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = {}

    def allow(self, *, bucket: str, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        if limit <= 0 or window_seconds <= 0:
            return True, 0
        now = time.time()
        cutoff = now - window_seconds
        token = f"{bucket}:{key}"
        with self._lock:
            queue = self._buckets.setdefault(token, deque())
            while queue and queue[0] < cutoff:
                queue.popleft()
            if len(queue) >= limit:
                retry_after = max(1, int(window_seconds - (now - queue[0])))
                return False, retry_after
            queue.append(now)
            return True, 0


rate_limiter = InMemoryRateLimiter()
