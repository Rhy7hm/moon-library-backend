"""Shared helpers for profile photos (staff users and clients)."""
from __future__ import annotations

import base64
import binascii

from .util import HttpError


def decode_image_b64(data) -> tuple[bytes, str, str]:
    """Decode a base64 photo; returns (bytes, content_type, file_ext)."""
    if not isinstance(data, str) or not data:
        raise HttpError(400, "Photo data is required")
    if len(data) > 2_000_000:
        raise HttpError(413, "Photo is too large")
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HttpError(400, "Bad photo data") from None
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg", "jpg"
    if len(raw) >= 8 and raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "image/png", "png"
    if len(raw) >= 12 and raw[8:12] == b"WEBP":
        return raw, "image/webp", "webp"
    raise HttpError(400, "Photo must be JPEG, PNG or WEBP")
