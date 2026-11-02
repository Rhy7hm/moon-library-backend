"""
How stored files are sent to browsers.

Uploaders choose a file's type, so a stored file can be anything — an SVG or HTML page with a script
in it included. Files are therefore never trusted to render as a page on this site:

  * only plain pictures, video, audio and PDFs open in the browser (INLINE_TYPES);
    everything else is sent as a download;
  * every file response carries a sandbox Content-Security-Policy, so even a file that does render
    can't run script with this site's cookies (PDFs excepted: browsers' PDF viewers don't load under
    a sandbox, and they don't run page script).
"""
from __future__ import annotations

INLINE_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
    "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
    "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm",
    "application/pdf",
}

SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"


def base_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def opens_inline(content_type: str | None) -> bool:
    return base_type(content_type) in INLINE_TYPES


def safe_file_headers(content_type: str | None) -> dict:
    """Headers every stored-file response gets (Content-Disposition only when it must download)."""
    t = base_type(content_type)
    headers = {"X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-site"}
    if t != "application/pdf":
        headers["Content-Security-Policy"] = SANDBOX_CSP
    if t not in INLINE_TYPES:
        headers["Content-Disposition"] = "attachment"
    return headers
