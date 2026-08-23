"""Vienna trip - family upload pipeline.

Reads whatever the family uploaded into R2 under inbox/, turns it into the same
kind of web media the original batch produced, and updates the manifest that the
site ships with. Safe to re-run: everything already handled is recorded in
public/media-index.json and skipped.

  inbox/<person>/<dayid|auto>/<stamp>-<name>   uploads land here
  originals/<person>/<name>                    kept forever, never served
  images/ thumbs/ videos/ posters/             what the site actually loads
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta

from PIL import Image, ImageOps

import r2

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception as e:                                    # noqa: BLE001
    print("note: HEIC support unavailable:", e)

try:
    import imagehash
except Exception:                                         # noqa: BLE001
    imagehash = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "_work")

# Firestore over plain HTTP: the pipeline only ever reads, and only public fields.
PROJECT = os.environ.get("FIREBASE_PROJECT", "trip-barmitzva")
API_KEY = os.environ.get("FIREBASE_API_KEY", "AIzaSyAnFZs-453bziGS9DZDZwk8qQy-oUc5mCQ")
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
# Every trip this app owns lives under its own folder. Anything at the root of the
# bucket belongs to the original single-trip site and is left alone.
OWNED = "t/"

IMG_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}
VID_EXT = {".mp4", ".mov", ".m4v", ".3gp", ".avi"}
# Hamming distance under which two photos count as the same picture.
# Measured on this trip's own photos: a WhatsApp round trip (shrink + heavy
# recompress) moves the fingerprint by 0, while two different photos from the
# trip are at least 26 apart. 6 sits safely in that gap.
PHASH_DUPE = 6


# ---------------------------------------------------------------- small helpers

def run(*cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(f"{cmd[0]} failed: {p.stderr.strip()[:400]}")
    return p.stdout


def load(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:                                     # noqa: BLE001
        return default


def save(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def _fs_value(v):
    if not isinstance(v, dict):
        return None
    for k in ("stringValue", "booleanValue", "timestampValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "arrayValue" in v:
        return [_fs_value(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: _fs_value(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    return None


def _fs_doc(path):
    import urllib.request
    try:
        with urllib.request.urlopen(f"{FS}/{path}?key={API_KEY}", timeout=20) as r:
            doc = json.loads(r.read().decode("utf-8"))
        return {k: _fs_value(v) for k, v in (doc.get("fields") or {}).items()}
    except Exception as e:                                # noqa: BLE001
        print("   could not read", path, e)
        return None


def trip_for(prefix):
    """The trip record behind a storage folder, or None if we cannot find it."""
    media_id = prefix.strip("/").split("/")[-1]
    idx = _fs_doc(f"mediaIndex/{media_id}")
    if not idx or not idx.get("tripId"):
        return None
    return _fs_doc(f"trips/{idx['tripId']}")


def day_dates(trip):
    """day id -> YYYY-MM-DD, taken from the trip's own itinerary."""
    out = {}
    for d in (trip or {}).get("days") or []:
        try:
            dd, mm, yy = str(d["date"]).split("-")
            out[d["id"]] = f"{yy}-{mm}-{dd}"
        except Exception:                                 # noqa: BLE001
            pass
    return out


# Anything that came through a chat app has no date inside it, but the name it was
# saved under usually still carries the day. Treated as a guess, never as a fact.
FILENAME_DATE = [
    re.compile(r"(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})[-_]"),      # IMG-20260811-WA0007
    re.compile(r"(?:^|[^\d])(\d{4})(\d{2})(\d{2})[_-]\d{6}"),     # 20260811_163643
]


def date_from_name(name):
    for rx in FILENAME_DATE:
        m = rx.search(name)
        if not m:
            continue
        y, mo, d = m.groups()
        if 2000 <= int(y) <= 2100 and 1 <= int(mo) <= 12 and 1 <= int(d) <= 31:
            return f"{y}-{mo}-{d}"
    return None


def safe_name(name):
    base = os.path.splitext(os.path.basename(name))[0]
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", base).strip("-")
    return base[:60] or "photo"


def unique(name, taken):
    if name not in taken:
        return name
    stem, ext = os.path.splitext(name)
    n = 2
    while f"{stem}-{n}{ext}" in taken:
        n += 1
    return f"{stem}-{n}{ext}"


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- metadata

def exif_bits(path):
    """(iso datetime or None, [lat, lon] or None) from a still image."""
    try:
        img = Image.open(path)
        ex = img.getexif()
    except Exception:                                     # noqa: BLE001
        return None, None
    # DateTimeOriginal and DateTimeDigitized live in the Exif sub-block,
    # only the plain DateTime sits in the main one.
    try:
        sub = ex.get_ifd(0x8769)
    except Exception:                                     # noqa: BLE001
        sub = {}
    dt = None
    for src, tag in ((sub, 36867), (sub, 36868), (ex, 306)):
        raw = src.get(tag) if src else None
        if raw:
            try:
                dt = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S").isoformat()
                break
            except ValueError:
                pass
    gps = None
    try:
        g = ex.get_ifd(0x8825)
        if g and 2 in g and 4 in g:
            def deg(v):
                return float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
            lat, lon = deg(g[2]), deg(g[4])
            if str(g.get(1, "N")).upper().startswith("S"):
                lat = -lat
            if str(g.get(3, "E")).upper().startswith("W"):
                lon = -lon
            if abs(lat) > 0.0001 or abs(lon) > 0.0001:
                gps = [round(lat, 6), round(lon, 6)]
    except Exception:                                     # noqa: BLE001
        pass
    return dt, gps


def video_bits(path):
    try:
        out = run("ffprobe", "-v", "quiet", "-print_format", "json",
                  "-show_format", "-show_streams", path)
        meta = json.loads(out)
    except Exception:                                     # noqa: BLE001
        return None, None
    tags = {k.lower(): v for k, v in (meta.get("format", {}).get("tags") or {}).items()}
    for s in meta.get("streams", []):
        for k, v in (s.get("tags") or {}).items():
            tags.setdefault(k.lower(), v)
    dt = None
    raw = tags.get("creation_time")
    if raw:
        try:
            dt = datetime.strptime(str(raw)[:19], "%Y-%m-%dT%H:%M:%S").isoformat()
        except ValueError:
            pass
    gps = None
    loc = tags.get("location") or tags.get("com.apple.quicktime.location.iso6709")
    if loc:
        m = re.match(r"([+-]\d+\.?\d*)([+-]\d+\.?\d*)", str(loc))
        if m:
            gps = [round(float(m.group(1)), 6), round(float(m.group(2)), 6)]
    return dt, gps


# ---------------------------------------------------------------- rendering
# Same recipe as the original batch, so new photos sit next to the old ones
# without looking different: 1600px long edge, gentle contrast stretch,
# a little more colour, mild sharpening.

def render_image(src, out_img, out_thumb):
    run("convert", src, "-auto-orient", "-resize", "1600x1600>",
        "-contrast-stretch", "0.1%x0.05%", "-modulate", "100,106",
        "-unsharp", "0x0.8+0.7+0.008", "-quality", "82", out_img)
    run("convert", out_img, "-resize", "420x420>", "-quality", "75", out_thumb)
    with Image.open(out_img) as im:
        return im.size


def render_video(src, out_vid, out_poster):
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
        "-vf", "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-crf", "27", "-preset", "fast", "-c:a", "aac", "-b:a", "128k",
        "-fps_mode", "vfr", "-map_metadata", "0", "-movflags", "+faststart", out_vid)
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", out_vid,
        "-frames:v", "1", "-q:v", "4", "-vf", "scale='min(640,iw)':-2", out_poster)


def to_jpeg(src):
    """HEIC/PNG/WEBP -> a plain JPEG that ImageMagick and dlib both cope with."""
    ext = os.path.splitext(src)[1].lower()
    if ext in (".jpg", ".jpeg"):
        return src
    dst = os.path.splitext(src)[0] + "__conv.jpg"
    with Image.open(src) as im:
        ImageOps.exif_transpose(im).convert("RGB").save(dst, "JPEG", quality=95)
    return dst


# ---------------------------------------------------------------- dedupe index

def phash_of(path):
    if imagehash is None:
        return None
    try:
        with Image.open(path) as im:
            return str(imagehash.phash(ImageOps.exif_transpose(im)))
    except Exception:                                     # noqa: BLE001
        return None


def hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def backfill_hashes(s3, prefix, index, manifest):
    """First run of a trip that already had photos: fingerprint what is on the site
    so a re-upload of one of them is recognised instead of added twice."""
    have = index.setdefault("phash", {})
    missing = [m["f"] for m in manifest if m["k"] == "image" and m["f"] not in have]
    if not missing:
        return
    print(f"   fingerprinting {len(missing)} photo(s) already on this trip (one time only)")
    tmp = os.path.join(WORK, "_bf.jpg")
    for i, name in enumerate(missing, 1):
        try:
            r2.get(s3, f"{prefix}images/{name}", tmp)
            h = phash_of(tmp)
            if h:
                have[name] = h
        except Exception as e:                            # noqa: BLE001
            print("   skip", name, e)
        if i % 100 == 0:
            print(f"     {i}/{len(missing)}")
    if os.path.exists(tmp):
        os.remove(tmp)


def process_trip(s3, prefix, inbox):
    """Turn one trip's inbox into web media, and rewrite that trip's manifest."""
    trip = trip_for(prefix)
    label = (trip or {}).get("title") or prefix or "(root)"
    print(f"\n=== {label} — {len(inbox)} new file(s) ===")
    dates = day_dates(trip)

    manifest = r2.get_json(s3, f"{prefix}manifest.json", [])
    index = r2.get_json(s3, f"{prefix}index.json", {})
    index.setdefault("done", {})       # inbox key -> what happened to it
    index.setdefault("md5", {})        # md5 -> media name
    index.setdefault("phash", {})      # media name -> perceptual fingerprint

    inbox = [(k, sz) for k, sz in inbox if k not in index["done"]]
    if not inbox:
        return []
    backfill_hashes(s3, prefix, index, manifest)

    taken = {m["f"] for m in manifest}
    added, skipped, failed, fresh = [], [], [], []

    for key, size in sorted(inbox):
        rest = key[len(prefix):].split("/")          # inbox / person / day / file
        person = rest[1] if len(rest) > 3 else "guest"
        day_hint = rest[2] if len(rest) > 3 else "auto"
        orig_name = rest[-1]
        # the upload endpoint prefixes a stamp to keep keys unique - drop it for display
        orig_name = re.sub(r"^\d{8}-\d{6}-[a-z0-9]{4}-", "", orig_name)
        ext = os.path.splitext(orig_name)[1].lower()
        kind = "image" if ext in IMG_EXT else "video" if ext in VID_EXT else None
        print(f"\n-> {orig_name}  ({size/1e6:.1f} MB, {person}, {day_hint})")

        if kind is None:
            print("   not a photo or video, ignored")
            index["done"][key] = {"status": "ignored"}
            r2.delete(s3, key)
            continue

        src = os.path.join(WORK, "src" + ext)
        if os.path.exists(src):
            os.remove(src)
        try:
            r2.get(s3, key, src)
        except Exception as e:                            # noqa: BLE001
            print("   download failed:", e)
            failed.append(orig_name)
            continue

        digest = md5(src)
        if digest in index["md5"]:
            print("   identical copy of", index["md5"][digest], "- skipped")
            index["done"][key] = {"status": "duplicate", "of": index["md5"][digest]}
            skipped.append(orig_name)
            r2.delete(s3, key)
            continue

        try:
            if kind == "image":
                jpeg = to_jpeg(src)
                ph = phash_of(jpeg)
                dupe = None
                if ph:
                    for name, other in index["phash"].items():
                        if hamming(ph, other) <= PHASH_DUPE:
                            dupe = name
                            break
                if dupe:
                    print("   same picture as", dupe, "- skipped")
                    index["done"][key] = {"status": "duplicate", "of": dupe}
                    skipped.append(orig_name)
                    r2.delete(s3, key)
                    continue

                dt, gps = exif_bits(jpeg)
                name = unique(f"{person}-{safe_name(orig_name)}.jpg", taken)
                out_img = os.path.join(WORK, "out.jpg")
                out_thumb = os.path.join(WORK, "thumb.jpg")
                w, h = render_image(jpeg, out_img, out_thumb)
                entry = {"f": name, "k": "image", "w": w, "h": h}
                r2.put(s3, f"{prefix}images/{name}", out_img)
                r2.put(s3, f"{prefix}thumbs/{name}", out_thumb)
                shutil.copy(out_img, os.path.join(WORK, "new", name))
                fresh.append(name)
                if ph:
                    index["phash"][name] = ph
            else:
                dt, gps = video_bits(src)
                name = unique(f"{person}-{safe_name(orig_name)}.mp4", taken)
                stem = os.path.splitext(name)[0]
                out_vid = os.path.join(WORK, "out.mp4")
                out_poster = os.path.join(WORK, "poster.jpg")
                render_video(src, out_vid, out_poster)
                entry = {"f": name, "k": "video", "poster": f"posters/{stem}.jpg"}
                r2.put(s3, f"{prefix}videos/{name}", out_vid)
                r2.put(s3, f"{prefix}posters/{stem}.jpg", out_poster)
        except Exception as e:                            # noqa: BLE001
            print("   could not process:", e)
            failed.append(orig_name)
            index["done"][key] = {"status": "failed", "why": str(e)[:200]}
            continue

        # No date inside the file - which is what happens to anything shared through
        # a chat app. Fall back, in order, to the day written into its filename and
        # then to the day the uploader picked, and mark the time as a guess.
        est = False
        if not dt:
            est = True
            guess = date_from_name(orig_name)
            base = guess or dates.get(day_hint)
            dt = f"{base}T12:00:00" if base else datetime.utcnow().replace(microsecond=0).isoformat()
            if guess:
                print("   date taken from the filename:", guess)

        entry["dt"] = dt
        if gps:
            entry["gps"] = gps
        if est:
            entry["est"] = True
        entry["src"] = person

        manifest.append(entry)
        taken.add(name)
        index["md5"][digest] = name
        index["done"][key] = {"status": "added", "as": name}
        added.append(name)
        print(f"   added as {name}  {dt}{' (time estimated)' if est else ''}"
              f"{' gps' if gps else ''}")

        # keep the untouched original, then clear the inbox slot
        r2.put(s3, f"{prefix}originals/{person}/{name.rsplit('.', 1)[0]}{ext}", src)
        r2.delete(s3, key)

    # nudge estimated times apart so the order inside a day stays stable
    seen = {}
    for m in manifest:
        if m.get("est"):
            n = seen.get(m["dt"], 0)
            seen[m["dt"]] = n + 1
            if n:
                m["dt"] = (datetime.fromisoformat(m["dt"]) + timedelta(seconds=n)).isoformat()

    manifest.sort(key=lambda m: (m["dt"], m["f"]))
    r2.put_json(s3, f"{prefix}manifest.json", manifest)
    r2.put_json(s3, f"{prefix}index.json", index)

    print(f"\n   {label}: added {len(added)} · duplicates {len(skipped)} · failed {len(failed)}")
    if failed:
        print("   failed:", ", ".join(failed[:20]))
    return fresh


def main():
    s3 = r2.client()
    os.makedirs(os.path.join(WORK, "new"), exist_ok=True)

    by_prefix = {}
    for key, size in r2.list_keys(s3, OWNED):
        i = key.find("inbox/")
        if i >= 0:
            by_prefix.setdefault(key[:i], []).append((key, size))

    if not by_prefix:
        print("nothing new in any inbox")
        save(os.path.join(WORK, "new.json"), {})
        return 0

    print(f"{len(by_prefix)} trip(s) with new media")
    fresh = {}
    for prefix, inbox in sorted(by_prefix.items()):
        try:
            names = process_trip(s3, prefix, inbox)
            if names:
                fresh[prefix] = names
        except Exception as e:                            # noqa: BLE001
            print(f"!! trip {prefix or '(root)'} failed entirely: {e}")

    save(os.path.join(WORK, "new.json"), fresh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
