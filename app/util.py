from __future__ import annotations

import secrets
import time

from flask import Response, jsonify

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


class HttpError(Exception):
    """An error with an HTTP status; the message goes to the browser as { error }."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def now() -> int:
    """Milliseconds since 1970 (the timestamps stored everywhere, as before)."""
    return int(time.time() * 1000)


def new_id(length: int = 12) -> str:
    """Short random id, URL-safe, e.g. "k3f9x2m1q8ab" (same alphabet and bias-free enough as before)."""
    return "".join(_ALPHABET[b % 36] for b in secrets.token_bytes(length))


def json_response(data, status: int = 200, headers: dict | None = None) -> Response:
    res = jsonify(data)
    res.status_code = status
    res.headers["Content-Type"] = "application/json; charset=utf-8"
    for k, v in (headers or {}).items():
        res.headers[k] = v
    return res


def is_num(v) -> bool:
    """A JSON number (not a bool), like `typeof v === 'number' && isFinite(v)`."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def js_str(v) -> bool:
    return isinstance(v, str)
