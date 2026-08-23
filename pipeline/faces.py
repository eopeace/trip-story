"""Name the people in newly ingested photos.

Matches every face found in a new photo against the family's own labelled faces
(`family-faces.json`, decrypted by the workflow). A name is only written when the
match is close AND clearly better than the runner-up, so a stranger or a bad angle
is left untagged rather than guessed. Everything written here is a suggestion:
the tagging panel on the site overrides it.

Deliberately NOT done: matching against a person's average face. That was tried
during the first pass and small groups turned into magnets that swallowed other
people. Nearest-neighbours against the real faces is what works.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

import r2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = os.path.join(ROOT, "_work", "new")
GALLERY = os.path.join(ROOT, "pipeline", "family-faces.json")

# Only trips that already have a named set of faces can be named automatically.
# A brand new trip has nobody to compare against: its faces wait for the owner to
# say who they are, which is the screen that comes next. For now the first trip is
# the only one with a gallery, and it lives at the root of the bucket.
GALLERY_PREFIXES = {os.environ.get("LEGACY_PREFIX", "")}

ACCEPT = 0.50      # dlib face distance; 0.6 is the usual "same person" line
MARGIN = 0.04      # the winner must beat the runner-up by at least this much
EMB = 1100
MODELS = os.environ.get("FACE_MODELS", "/tmp/face_models")


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


def faces_in(path, cnn, hog, sp, enc):
    """Union of two detectors: the CNN catches profiles, HOG with upsampling
    catches small faces. Neither alone finds enough."""
    import dlib
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
        if b[2] - b[0] < 28:
            continue
        rect = dlib.rectangle(*b)
        out.append(np.array(enc.compute_face_descriptor(arr, sp(arr, rect), 1), dtype=np.float32))
    return out


def main():
    fresh = json.load(open(os.path.join(ROOT, "_work", "new.json")))
    if not fresh:
        print("no new photos to look at")
        return 0
    if not os.path.exists(GALLERY):
        print("no face gallery available - leaving photos untagged")
        return 0

    todo = {p: n for p, n in fresh.items() if p in GALLERY_PREFIXES}
    skipped = [p for p in fresh if p not in GALLERY_PREFIXES]
    for p in skipped:
        print(f"trip {p or '(root)'}: no named faces yet, leaving {len(fresh[p])} photo(s) untagged")
    if not todo:
        return 0

    g = json.load(open(GALLERY))
    people = sorted({f["p"] for f in g["faces"]})
    vecs = {p: np.array([f["v"] for f in g["faces"] if f["p"] == p], dtype=np.float32)
            for p in people}
    print("gallery:", {p: len(v) for p, v in vecs.items()})

    cnn, hog, sp, enc = detectors()
    s3 = r2.client()

    for prefix, names in todo.items():
        _name_photos(prefix, names, vecs, cnn, hog, sp, enc, s3)
    return 0


def _name_photos(prefix, names, vecs, cnn, hog, sp, enc, s3):
    tags = r2.get_json(s3, f"{prefix}people-tags.json", {})
    found = 0
    for name in names:
        path = os.path.join(NEW, name)
        if not os.path.exists(path):
            continue
        try:
            fs = faces_in(path, cnn, hog, sp, enc)
        except Exception as e:                            # noqa: BLE001
            print("  ", name, "face check failed:", e)
            continue
        who = []
        for v in fs:
            scores = []
            for p, mat in vecs.items():
                d = np.linalg.norm(mat - v, axis=1)
                d.sort()
                scores.append((float(d[: min(3, len(d))].mean()), p))
            scores.sort()
            if scores and scores[0][0] < ACCEPT and (
                    len(scores) == 1 or scores[1][0] - scores[0][0] >= MARGIN):
                who.append(scores[0][1])
        who = sorted(set(who))
        if who:
            tags[name] = who
            found += 1
        print(f"   {name}: {len(fs)} face(s) -> {', '.join(who) if who else 'no confident match'}")

    r2.put_json(s3, f"{prefix}people-tags.json", dict(sorted(tags.items())))
    print(f"named people in {found} of {len(names)} new photos")


if __name__ == "__main__":
    sys.exit(main())
