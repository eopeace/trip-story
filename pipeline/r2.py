"""Thin Cloudflare R2 helper. R2 speaks the S3 API, so boto3 works as-is."""
import os
import boto3
from botocore.config import Config

BUCKET = os.environ.get("R2_BUCKET", "vienna-trip-media")


def client():
    acct = os.environ["R2_ACCOUNT_ID"]
    # the bucket is in the EU jurisdiction, which has its own endpoint host
    endpoint = os.environ.get("R2_ENDPOINT") or f"https://{acct}.eu.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def list_keys(s3, prefix):
    out = []
    token = None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        r = s3.list_objects_v2(**kw)
        for o in r.get("Contents", []):
            if not o["Key"].endswith("/"):
                out.append((o["Key"], o["Size"]))
        if not r.get("IsTruncated"):
            return out
        token = r.get("NextContinuationToken")


CTYPE = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".mp4": "video/mp4", ".mov": "video/mp4", ".webp": "image/webp"}


def put(s3, key, path):
    ext = os.path.splitext(key)[1].lower()
    with open(path, "rb") as fh:
        s3.put_object(Bucket=BUCKET, Key=key, Body=fh,
                      ContentType=CTYPE.get(ext, "application/octet-stream"),
                      CacheControl="public, max-age=31536000, immutable")


def get(s3, key, path):
    s3.download_file(BUCKET, key, path)


def copy(s3, src, dst):
    s3.copy_object(Bucket=BUCKET, CopySource={"Bucket": BUCKET, "Key": src}, Key=dst)


def delete(s3, key):
    s3.delete_object(Bucket=BUCKET, Key=key)


def get_json(s3, key, default):
    """A small JSON object stored beside the media. Missing is not an error."""
    import json
    try:
        r = s3.get_object(Bucket=BUCKET, Key=key)
        return json.loads(r["Body"].read().decode("utf-8"))
    except Exception:                                     # noqa: BLE001
        return default


def put_json(s3, key, data):
    import json
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    s3.put_object(Bucket=BUCKET, Key=key, Body=body,
                  ContentType="application/json; charset=utf-8",
                  CacheControl="no-cache")


def prefixes_with(s3, marker="inbox/"):
    """Every trip prefix that currently has something waiting in its inbox."""
    out = set()
    for key, _ in list_keys(s3, ""):
        i = key.find(marker)
        if i >= 0:
            out.add(key[:i])
    return out
