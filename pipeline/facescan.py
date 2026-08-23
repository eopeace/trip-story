"""Who is in the photos of a trip that has never been tagged.

A brand new trip has nobody to compare against, so nothing can be named
automatically. What this does instead:

  1. finds every face in the trip's photos and remembers it (a small crop, and
     the 128 numbers that describe the face),
  2. puts faces that look like the same person into one group,
  3. writes those groups next to the photos, so the site can show the owner a
     "who is this?" screen,
  4. reads back the names the owner gave, and from then on names that person
     everywhere - in the photos already on the site and in every photo that
     arrives later.

Nothing here guesses a name on its own before the owner has said one. Once a
person has named faces, a new face is only given that name when the match is
close AND clearly better than the runner-up; anything less is left for the
owner. Everything written is a suggestion - the tagging panel overrides it.

Files it keeps beside a trip's photos:
  <prefix>face-index.json   every face: its photo, its box, its numbers, its group
  <prefix>faces.json        what the naming screen reads (crops and counts only)
  <prefix>faces/<id>.jpg    one small crop per face
  <prefix>people-tags.json  photo -> the people in it, which the gallery reads
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageOps

import r2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "_work")
NEW = os.path.join(WORK, "new")
MODELS = os.environ.get("FACE_MODELS", "/tmp/face_models")

PROJECT = os.environ.get("FIREBASE_PROJECT", "trip-barmitzva")
API_KEY = os.environ.get("FIREBASE_API_KEY", "AIzaSyAnFZs-453bziGS9DZDZwk8qQy-oUc5mCQ")
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

OWNED = "t/"          # only trips this app created; the root belongs to Vienna

# dlib face distance. 0.6 is the usual "same person" line; both numbers here are
# deliberately stricter, because a wrong name is worse than a missing one.
JOIN = 0.47           # close enough to sit in the same unnamed group
ACCEPT = 0.50         # close enough to inherit a name the owner already gave
MARGIN = 0.04         # ...and it must beat the second-best person by this much
EMB = 1100            # long edge the face descriptor is computed at
MIN_FACE = 34         # ignore faces smaller than this, they are never nameable
CROP_PAD = 0.35       # show a little around the face so it is recognisable
CROP_PX = 220
MAX_CROPS = 9         # crops sent to the naming screen per group
MAX_GROUPS = 80       # groups sent to the naming screen at once
MIN_GROUP = 1         # even a face seen once can be named - it is often the point
BACKFILL = 400        # photos already on a trip looked at per run, so one run ends


# ------------------------------------------------------------------ firestore

def _val(v):
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
        return [_val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: _val(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    return None


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:                                # noqa: BLE001
        print("   could not read", url.split("?")[0].split("/documents/")[-1], e)
        return None


def doc(path):
    d = _get(f"{FS}/{path}?key={API_KEY}")
    return None if not d else {k: _val(v) for k, v in (d.get("fields") or {}).items()}


def collection(path):
    """Every document in a collection, as {id: fields}. Read-only, no SDK."""
    out, token = {}, None
    while True:
        url = f"{FS}/{path}?key={API_KEY}&pageSize=300"
        if token:
            url += f"&pageToken={token}"
        page = _get(url)
        if not page:
            return out
        for d in page.get("documents", []):
            out[d["name"].split("/")[-1]] = {k: _val(v) for k, v in (d.get("fields") or {}).items()}
        token = page.get("nextPageToken")
        if not token:
            return out


def trip_for(prefix):
    media_id = prefix.strip("/").split("/")[-1]
    idx = doc(f"mediaIndex/{media_id}")
    if not idx or not idx.get("tripId"):
        return None, None
    return idx["tripId"], doc(f"trips/{idx['tripId']}")


# ------------------------------------------------------------------- detection

def detectors():
    import dlib
    return (dlib.cnn_face_detection_model_v1(f"{MODELS}/mmod_human_face_detector.dat"),
            dlib.get_frontal_face_detector(),
            dlib.shape_predictor(f"{MODELS}/shape_predictor_68_face_landmarks.dat"),
            dlib.face_recognition_model_v1(f"{MODELS}/dlib_face_recognition_resnet_model_v1.dat"))


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x2 - x1) * max(0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / ua if ua else 0


def faces_boxed(path, det):
    """[(box, 128 numbers)] for one photo, plus the image the boxes belong to.

    Two detectors are used together: the CNN catches faces in profile, HOG with
    upsampling catches small ones. Neither alone finds enough of them.
    """
    import dlib
    cnn, hog, sp, enc = det
    base = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    w, h = base.size
    se = min(1, EMB / max(w, h))
    em = base.resize((int(w * se), int(h * se))) if se < 1 else base
    arr = np.array(em)

    boxes = []
    s1 = min(1, 700 / max(w, h))
    i1 = base.resize((int(w * s1), int(h * s1))) if s1 < 1 else base
    for d in cnn(np.array(i1), 0):
        if d.confidence < 0.4:
            continue
        r, k = d.rect, se / s1
        boxes.append([int(r.left() * k), int(r.top() * k), int(r.right() * k), int(r.bottom() * k)])
    s2 = min(1, 1000 / max(w, h))
    i2 = base.resize((int(w * s2), int(h * s2))) if s2 < 1 else base
    for r in hog(np.array(i2), 2):
        k = se / s2
        b = [int(r.left() * k), int(r.top() * k), int(r.right() * k), int(r.bottom() * k)]
        if all(iou(b, x) < 0.35 for x in boxes):
            boxes.append(b)

    out = []
    for b in boxes:
        if b[2] - b[0] < MIN_FACE:
            continue
        rect = dlib.rectangle(*b)
        v = np.array(enc.compute_face_descriptor(arr, sp(arr, rect), 1), dtype=np.float32)
        out.append((b, v))
    return em, out


def crop_of(img, box):
    x1, y1, x2, y2 = box
    pad = int((x2 - x1) * CROP_PAD)
    w, h = img.size
    c = img.crop((max(0, x1 - pad), max(0, y1 - pad), min(w, x2 + pad), min(h, y2 + pad)))
    c.thumbnail((CROP_PX, CROP_PX))
    return c


# -------------------------------------------------------------------- matching

def nearest(vecs_by_person, v):
    """(person, distance) of the closest named person, or (None, None).

    Compared against that person's real faces, never against their average: an
    average face turns a small group into a magnet that swallows other people.
    """
    scores = []
    for p, mat in vecs_by_person.items():
        d = np.linalg.norm(mat - v, axis=1)
        d.sort()
        scores.append((float(d[: min(3, len(d))].mean()), p))
    if not scores:
        return None, None
    scores.sort()
    best = scores[0]
    if best[0] < ACCEPT and (len(scores) == 1 or scores[1][0] - best[0] >= MARGIN):
        return best[1], best[0]
    return None, best[0]


def group_for(groups, v):
    """The unnamed group this face belongs in, or None to start a new one."""
    best, bd = None, 9.0
    for gid, mat in groups.items():
        d = np.linalg.norm(mat - v, axis=1)
        d.sort()
        s = float(d[: min(3, len(d))].mean())
        if s < bd:
            best, bd = gid, s
    return best if bd < JOIN else None


# ------------------------------------------------------------------- one trip

def scan_trip(s3, prefix, fresh, load_det):
    trip_id, trip = trip_for(prefix)
    if not trip_id:
        print(f"   {prefix}: no trip behind this folder, skipped")
        return
    label = (trip or {}).get("title") or prefix
    state = r2.get_json(s3, f"{prefix}face-index.json", {})
    faces = state.get("faces") or {}
    seen_photos = set(state.get("photos") or [])
    next_id = int(state.get("next") or 1)

    # ---- 1. find the faces in whatever has not been looked at yet.
    # Photos from this run sit on disk already; photos that were on the trip
    # before any of this existed are fetched back, a few hundred per run, so the
    # first run of an old trip finishes instead of timing out.
    todo = [n for n in (fresh or []) if n not in seen_photos]
    on_disk = set(todo)
    manifest = r2.get_json(s3, f"{prefix}manifest.json", [])
    older = [m["f"] for m in manifest
             if m.get("k") == "image" and m["f"] not in seen_photos and m["f"] not in on_disk]
    if older:
        print(f"   {label}: {len(older)} photo(s) from before, looking at {min(len(older), BACKFILL)}")
        todo += older[:BACKFILL]
    if not todo:
        det = None
    else:
        det = load_det()
        if det is None:
            print(f"   {label}: face models unavailable, {len(todo)} photo(s) left for next run")
            todo = []

    added = 0
    for name in todo:
        path = os.path.join(NEW, name)
        if name not in on_disk:
            path = os.path.join(WORK, "_scan" + os.path.splitext(name)[1].lower())
            try:
                r2.get(s3, f"{prefix}images/{name}", path)
            except Exception as e:                        # noqa: BLE001
                print("   ", name, "could not be fetched:", e)
                continue
        if not os.path.exists(path):
            seen_photos.add(name)
            continue
        try:
            img, found = faces_boxed(path, det)
        except Exception as e:                            # noqa: BLE001
            print("   ", name, "face check failed:", e)
            continue
        for box, v in found:
            fid = f"f{next_id}"
            next_id += 1
            try:
                tmp = os.path.join(WORK, "_crop.jpg")
                crop_of(img, box).save(tmp, "JPEG", quality=82)
                r2.put(s3, f"{prefix}faces/{fid}.jpg", tmp)
            except Exception as e:                        # noqa: BLE001
                print("   ", name, "could not save a face crop:", e)
                continue
            faces[fid] = {"f": name, "b": box, "v": [round(float(x), 5) for x in v],
                          "g": None, "p": None}
            added += 1
        seen_photos.add(name)
    if added:
        print(f"   {label}: {added} new face(s) in {len(todo)} photo(s)")

    # ---- 2. the names the owner has given so far
    answers = collection(f"trips/{trip_id}/faceNames")
    named_group = {gid: a.get("person") for gid, a in answers.items() if a.get("person")}
    ignored = {gid for gid, a in answers.items() if a.get("ignore")}

    for f in faces.values():
        g = f.get("g")
        if g in ignored:
            f["p"] = None
            f["skip"] = True
        elif g in named_group:
            f["p"] = named_group[g]
            f.pop("skip", None)
        elif f.get("skip"):
            f.pop("skip", None)          # the owner changed their mind

    # ---- 3. faces of people who now have a name, to compare newcomers against
    vecs = {}
    for f in faces.values():
        if f.get("p"):
            vecs.setdefault(f["p"], []).append(f["v"])
    vecs = {p: np.array(v, dtype=np.float32) for p, v in vecs.items()}

    # ---- 4. place every face that still has no name
    groups, waved = {}, {}
    for fid, f in faces.items():
        if not f.get("g") or f.get("p"):
            continue
        (waved if f.get("skip") else groups).setdefault(f["g"], []).append(f["v"])
    groups = {g: np.array(v, dtype=np.float32) for g, v in groups.items()}
    waved = {g: np.array(v, dtype=np.float32) for g, v in waved.items()}
    used = list(groups) + list(waved)
    next_g = max([int(g[1:]) for g in used if g[1:].isdigit()] + [0]) + 1

    for fid, f in faces.items():
        if f.get("p") or f.get("skip"):
            continue
        v = np.array(f["v"], dtype=np.float32)
        who, _ = nearest(vecs, v)
        if who:
            f["p"] = who                     # someone the owner already named
            continue
        # Someone the owner has already waved away once. Join them quietly
        # rather than asking about the same passer-by again.
        away = group_for(waved, v)
        if away is not None:
            f["g"] = away
            f["skip"] = True
            waved[away] = np.vstack([waved[away], v])
            continue
        if f.get("g") in groups:
            continue                         # already sitting in a group
        gid = group_for(groups, v)
        if gid is None:
            gid = f"g{next_g}"
            next_g += 1
            groups[gid] = v.reshape(1, -1)
        else:
            groups[gid] = np.vstack([groups[gid], v])
        f["g"] = gid

    # ---- 5. what the gallery reads: photo -> the people in it
    tags = {}
    for f in faces.values():
        if f.get("p"):
            tags.setdefault(f["f"], set()).add(f["p"])
    r2.put_json(s3, f"{prefix}people-tags.json",
                {k: sorted(v) for k, v in sorted(tags.items())})

    # ---- 6. what the naming screen reads
    by_group = {}
    for fid, f in faces.items():
        if f.get("p") or f.get("skip") or not f.get("g"):
            continue
        by_group.setdefault(f["g"], []).append(fid)
    pending = sorted(((g, ids) for g, ids in by_group.items() if len(ids) >= MIN_GROUP),
                     key=lambda x: -len(x[1]))
    public = {
        "pending": len(pending),
        "singles": sum(1 for g, ids in by_group.items() if len(ids) < MIN_GROUP),
        "named": {p: int(len(v)) for p, v in vecs.items()},
        "groups": [{"id": g, "n": len(ids),
                    "crops": [f"faces/{i}.jpg" for i in ids[:MAX_CROPS]],
                    "photos": sorted({faces[i]["f"] for i in ids})[:MAX_CROPS]}
                   for g, ids in pending[:MAX_GROUPS]],
    }
    r2.put_json(s3, f"{prefix}faces.json", public)

    state = {"faces": faces, "photos": sorted(seen_photos), "next": next_id}
    r2.put_json(s3, f"{prefix}face-index.json", state)

    # A small public note saying when the trip was last looked at, so the site can
    # tell a visitor whether their photos have been through yet instead of asking
    # them to guess.
    r2.put_json(s3, f"{prefix}status.json", {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "photos": sum(1 for m in manifest if m.get("k") == "image"),
        "videos": sum(1 for m in manifest if m.get("k") == "video"),
        "faces": len(faces),
        "named": {p: int(len(v)) for p, v in vecs.items()},
        "pending": len(pending),
    })
    print(f"   {label}: {len(faces)} face(s) · named {sum(1 for f in faces.values() if f.get('p'))}"
          f" · {len(pending)} group(s) waiting for a name")


# ----------------------------------------------------------------------- main

def main():
    fresh = {}
    try:
        with open(os.path.join(WORK, "new.json"), encoding="utf-8") as fh:
            fresh = json.load(fh)
    except Exception:                                     # noqa: BLE001
        pass

    s3 = r2.client()
    # Every trip with photos gets a look, not only the ones with new photos: a
    # trip the owner has just named people in has work to do even when nothing
    # was uploaded since.
    prefixes = set(fresh)
    for key, _ in r2.list_keys(s3, OWNED):
        if "/manifest.json" in key or key.endswith("manifest.json"):
            prefixes.add(key[: key.rfind("manifest.json")])
    prefixes = {p for p in prefixes if p.startswith(OWNED)}
    if not prefixes:
        print("no trips to look at")
        return 0

    # The models are only loaded if some trip actually has photos to look at,
    # and then only once for the whole run.
    box = {}

    def load_det():
        if "d" not in box:
            try:
                box["d"] = detectors()
            except Exception as e:                        # noqa: BLE001
                print("face models unavailable:", e)
                box["d"] = None
        return box["d"]

    print(f"{len(prefixes)} trip(s)")
    for prefix in sorted(prefixes):
        try:
            scan_trip(s3, prefix, fresh.get(prefix, []), load_det)
        except Exception as e:                            # noqa: BLE001
            print(f"!! {prefix} failed: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
