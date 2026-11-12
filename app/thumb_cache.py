"""
Thumbnails and video posters kept on this server's disk, so opening a folder doesn't fetch every
small picture from R2 again (for every person, every time).

Only t/ and p/ keys: they are small and never change (a new cover gets a new key). Whoever asks is
checked before this is reached; a file that is deleted from storage is dropped here too.
The folder is kept under THUMB_CACHE_MB (default 1024; 0 turns the cache off).
"""
from __future__ import annotations

import hashlib
import os
import random
import tempfile

from flask import current_app, has_app_context

MAX_OBJECT = 1024 * 1024  # bigger than this isn't a thumbnail


def _dir() -> str | None:
    if not has_app_context():
        return None
    c = current_app.config
    if int(c.get("THUMB_CACHE_MB") or 0) <= 0:
        return None
    return c.get("THUMB_CACHE_DIR") or os.path.join(current_app.instance_path, "thumb-cache")


def cacheable(key: str) -> bool:
    return key.startswith(("t/", "p/"))


def _path(root: str, key: str) -> str:
    h = hashlib.sha1(key.encode()).hexdigest()
    return os.path.join(root, h[:2], h[2:])


def get(key: str):
    """→ (content_type, etag, bytes) or None."""
    root = _dir()
    if not root or not cacheable(key):
        return None
    try:
        with open(_path(root, key), "rb") as f:
            head = f.readline().decode().rstrip("\n").split("\t")
            body = f.read()
        if len(head) != 2 or not body:
            return None
        return head[0], head[1], body
    except OSError:
        return None


def put(key: str, content_type: str | None, etag: str | None, body: bytes) -> None:
    root = _dir()
    if not root or not cacheable(key) or not body or len(body) > MAX_OBJECT:
        return
    path = _path(root, key)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # written beside it, then moved into place: nobody reads half a file
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
        with os.fdopen(fd, "wb") as f:
            f.write(f"{(content_type or 'application/octet-stream').replace(chr(9), ' ')}\t{(etag or '').replace(chr(9), ' ')}\n".encode())
            f.write(body)
        os.replace(tmp, path)
    except OSError:
        return  # a full or read-only disk only means no cache
    if random.random() < 0.005:
        prune(root)


def drop(keys: list[str]) -> None:
    root = _dir()
    if not root:
        return
    for k in keys:
        if k and cacheable(k):
            try:
                os.remove(_path(root, k))
            except OSError:
                pass


def prune(root: str | None = None) -> int:
    """Removes the pictures not looked at for the longest, until the folder is under its limit. → files removed."""
    root = root or _dir()
    if not root:
        return 0
    limit = int(current_app.config.get("THUMB_CACHE_MB") or 0) * 1024 * 1024
    files, total = [], 0
    for d, _dirs, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            files.append((max(st.st_atime, st.st_mtime), st.st_size, p))
            total += st.st_size
    if total <= limit:
        return 0
    removed = 0
    for _t, size, p in sorted(files):
        try:
            os.remove(p)
        except OSError:
            continue
        total -= size
        removed += 1
        if total <= limit * 0.8:
            break
    return removed
