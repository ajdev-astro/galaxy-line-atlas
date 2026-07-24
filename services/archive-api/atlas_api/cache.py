from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Generic, TypeVar


T = TypeVar("T")


class BoundedTTLCache(Generic[T]):
    """A process-local LRU cache with a hard item cap and expiry."""

    def __init__(self, max_items: int, ttl_seconds: int):
        self.max_items = max(0, max_items)
        self.ttl_seconds = max(1, ttl_seconds)
        self._items: OrderedDict[str, tuple[float, T]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> T | None:
        if self.max_items == 0:
            return None
        now = time.monotonic()
        with self._lock:
            item = self._items.pop(key, None)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= now:
                return None
            self._items[key] = item
            return value

    def set(self, key: str, value: T) -> None:
        if self.max_items == 0:
            return
        with self._lock:
            self._items.pop(key, None)
            self._items[key] = (time.monotonic() + self.ttl_seconds, value)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"items": len(self._items), "max_items": self.max_items}
