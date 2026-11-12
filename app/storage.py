"""
File storage: Cloudflare R2 through its S3-compatible API (boto3).

Same object keys as before (o/ originals, v/ light copies, t/ thumbnails, p/ posters, i/ icons),
same stored metadata (Content-Type, Content-Disposition for downloads, Cache-Control).
Everything is streamed: nothing reads a whole file into memory.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import IO, Iterator

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from flask import current_app

IMMUTABLE = "public, max-age=31536000, immutable"


@dataclass
class ObjectInfo:
    key: str
    size: int
    etag: str  # with quotes, like R2's httpEtag
    content_type: str | None
    content_disposition: str | None
    last_modified: datetime | None


class StorageError(Exception):
    pass


def _not_found(e: ClientError) -> bool:
    code = str(e.response.get("Error", {}).get("Code", ""))
    status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return code in ("404", "NoSuchKey", "NotFound") or status == 404


class R2Storage:
    def __init__(self, endpoint: str | None, key_id: str | None, secret: str | None, bucket: str, region: str = "auto"):
        if not endpoint or not key_id or not secret:
            raise StorageError("R2 is not configured: set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY")
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name=region or "auto",
            config=BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 4, "mode": "standard"},
                # R2 doesn't support every newer S3 checksum header; only send them when required
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                max_pool_connections=20,
                connect_timeout=10,
                read_timeout=120,
            ),
        )

    # ---------------------------------------------------------------- read
    def head(self, key: str) -> ObjectInfo | None:
        try:
            r = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if _not_found(e):
                return None
            raise
        return ObjectInfo(key, int(r["ContentLength"]), r.get("ETag", ""), r.get("ContentType"), r.get("ContentDisposition"), r.get("LastModified"))

    def get(self, key: str, range_header: str | None = None):
        """→ (ObjectInfo, body stream, content_range or None) or None. Raises InvalidRange as StorageError('range')."""
        kw = {"Bucket": self.bucket, "Key": key}
        if range_header:
            kw["Range"] = range_header
        try:
            r = self.client.get_object(**kw)
        except ClientError as e:
            if _not_found(e):
                return None
            if e.response.get("Error", {}).get("Code") == "InvalidRange" or e.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 416:
                raise StorageError("range") from e
            raise
        total = None
        cr = r.get("ContentRange")
        if cr and "/" in cr:
            try:
                total = int(cr.rsplit("/", 1)[1])
            except ValueError:
                total = None
        info = ObjectInfo(key, total if total is not None else int(r["ContentLength"]), r.get("ETag", ""), r.get("ContentType"), r.get("ContentDisposition"), r.get("LastModified"))
        return info, r["Body"], cr, int(r["ContentLength"])

    def iter_object(self, key: str, chunk: int = 256 * 1024) -> Iterator[bytes]:
        got = self.get(key)
        if not got:
            return
        _info, body, _cr, _len = got
        try:
            for part in body.iter_chunks(chunk):
                if part:
                    yield part
        finally:
            body.close()

    def read_range(self, key: str, offset: int, length: int) -> bytes:
        got = self.get(key, f"bytes={offset}-{offset + length - 1}")
        if not got:
            raise StorageError("The original file is missing from storage")
        _info, body, _cr, _len = got
        try:
            return body.read()
        finally:
            body.close()

    # ---------------------------------------------------------------- write
    def put(self, key: str, data: bytes | IO[bytes], length: int, content_type: str, content_disposition: str | None = None, cache_control: str = IMMUTABLE) -> None:
        kw = {"Bucket": self.bucket, "Key": key, "Body": data, "ContentLength": length, "ContentType": content_type, "CacheControl": cache_control}
        if content_disposition:
            kw["ContentDisposition"] = content_disposition
        self.client.put_object(**kw)

    def copy(self, src: str, dst: str) -> None:
        """A copy made inside R2 (nothing passes through this server), keeping its type, name and caching."""
        info = self.client.head_object(Bucket=self.bucket, Key=src)
        if info["ContentLength"] <= 5 * 1024**3:
            self.client.copy_object(Bucket=self.bucket, Key=dst, CopySource={"Bucket": self.bucket, "Key": src}, MetadataDirective="COPY")
            return
        # over 5 GB: copied in parts (the type and name are set again, as parts don't carry them)
        extra = {k: info[k] for k in ("ContentType", "ContentDisposition", "CacheControl") if info.get(k)}
        self.client.copy({"Bucket": self.bucket, "Key": src}, self.bucket, dst, ExtraArgs=extra)

    def create_multipart(self, key: str, content_type: str, content_disposition: str | None = None, cache_control: str = IMMUTABLE) -> str:
        kw = {"Bucket": self.bucket, "Key": key, "ContentType": content_type, "CacheControl": cache_control}
        if content_disposition:
            kw["ContentDisposition"] = content_disposition
        return self.client.create_multipart_upload(**kw)["UploadId"]

    def upload_part(self, key: str, upload_id: str, part: int, data: IO[bytes], length: int) -> str:
        r = self.client.upload_part(Bucket=self.bucket, Key=key, UploadId=upload_id, PartNumber=part, Body=data, ContentLength=length)
        return r["ETag"]

    def complete_multipart(self, key: str, upload_id: str, parts: list[dict]) -> None:
        self.client.complete_multipart_upload(
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": [{"PartNumber": int(p["partNumber"]), "ETag": str(p["etag"])} for p in parts]},
        )

    def abort_multipart(self, key: str, upload_id: str) -> None:
        self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)

    def delete(self, keys: list[str]) -> None:
        keys = list(dict.fromkeys(k for k in keys if k))
        from . import thumb_cache

        thumb_cache.drop(keys)  # this server's own copies of thumbnails go first
        transient = {
            "InternalError", "InternalFailure", "ServiceUnavailable", "SlowDown",
            "RequestTimeout", "RequestTimeoutException", "Throttling",
            "ThrottlingException", "OperationAborted",
        }
        for i in range(0, len(keys), 900):
            pending = keys[i : i + 900]
            for attempt in range(3):
                response = self.client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": [{"Key": k} for k in pending], "Quiet": True},
                )
                errors = response.get("Errors") or []
                if not errors:
                    break
                # A successful HTTP response may contain failed object deletes.
                # Never let callers discard the database references on failure.
                if attempt == 2 or any(
                    e.get("Code") not in transient or e.get("Key") not in pending
                    for e in errors
                ):
                    codes = ", ".join(sorted({str(e.get("Code", "Unknown")) for e in errors}))
                    raise StorageError(f"Failed to delete {len(errors)} storage object(s): {codes}")
                pending = list(dict.fromkeys(e["Key"] for e in errors))
                time.sleep(0.25 * (2 ** attempt))


_lock = threading.Lock()


def storage() -> R2Storage:
    """The app's storage client (one per process; boto3 clients are thread-safe)."""
    app = current_app._get_current_object()
    s = app.extensions.get("moonlib_storage")
    if s is None:
        with _lock:
            s = app.extensions.get("moonlib_storage")
            if s is None:
                c = app.config
                s = R2Storage(c["R2_ENDPOINT_URL"], c["R2_ACCESS_KEY_ID"], c["R2_SECRET_ACCESS_KEY"], c["R2_BUCKET_NAME"], c["R2_REGION"])
                app.extensions["moonlib_storage"] = s
    return s
