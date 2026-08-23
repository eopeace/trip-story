/**
 * Hands whoever holds a trip's upload link a set of one-time upload links.
 *
 * The link is the permission - no account, no app. That is deliberate: making
 * people sign up at the moment they are about to share photos is where they stop.
 * The owner can revoke a link at any time, which flips `open` on the token.
 *
 * The browser then uploads straight to storage with those links, so big videos
 * never pass through this function and - the whole point - each photo keeps the
 * date and place recorded inside it.
 */
import { createHmac, createHash, randomUUID } from "node:crypto";

const PROJECT = "trip-barmitzva";
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyAnFZs-453bziGS9DZDZwk8qQy-oUc5mCQ";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const MAX_FILES = 60;
const MAX_BYTES = 600 * 1024 * 1024;
const OK_EXT = /\.(jpe?g|png|heic|heif|webp|mp4|mov|m4v|3gp|avi)$/i;

const val = (v) => {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  return null;
};

/** Look the link up. The rules only expose tokens that are still open. */
async function resolveToken(token) {
  if (!/^[a-z0-9]{10,40}$/.test(token || "")) return null;
  const res = await fetch(`${FS}/uploadTokens/${token}?key=${API_KEY}`);
  if (!res.ok) return null;
  const doc = await res.json();
  const f = doc.fields || {};
  if (val(f.open) === false) return null;
  return { tripId: val(f.tripId), prefix: val(f.prefix) || "" };
}

/* ---------- AWS SigV4 presigned PUT, which is what R2 speaks ---------- */

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (key, s) => createHmac("sha256", key).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
  "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (s) => s.split("/").map(enc).join("/");

function presignPut(key, seconds = 3600) {
  const account = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET || "vienna-trip-media";
  const ak = process.env.R2_ACCESS_KEY_ID;
  const sk = process.env.R2_SECRET_ACCESS_KEY;
  const host = process.env.R2_HOST || `${account}.eu.r2.cloudflarestorage.com`;

  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const path = `/${bucket}/${encPath(key)}`;

  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${ak}/${scope}`],
    ["X-Amz-Date", now],
    ["X-Amz-Expires", String(seconds)],
    ["X-Amz-SignedHeaders", "host"],
  ].map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join("&");

  const canonical = ["PUT", path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256hex(canonical)].join("\n");
  let k = hmac(`AWS4${sk}`, day);
  for (const part of ["auto", "s3", "aws4_request"]) k = hmac(k, part);
  const signature = createHmac("sha256", k).update(toSign).digest("hex");

  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

/* ---------------------------------------------------------------- handler */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** A person's name, safe to put in a storage key. Falls back to "guest". */
const who = (s) => (String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "guest");

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!process.env.R2_ACCESS_KEY_ID) return json({ error: "server is not set up yet" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  const trip = await resolveToken(body.token);
  if (!trip) return json({ error: "הקישור הזה כבר לא פעיל" }, 403);

  const day = /^d\d+$/.test(body.day || "") ? body.day : "auto";
  const person = who(body.name);
  const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
  if (!files.length) return json({ error: "no files" }, 400);

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/^(\d{8})/, "$1-");
  const out = [];
  for (const f of files) {
    const name = String(f?.name || "");
    if (!OK_EXT.test(name)) { out.push({ name, error: "לא תמונה או סרטון" }); continue; }
    if (Number(f.size) > MAX_BYTES) { out.push({ name, error: "גדול מדי (מעל 600MB)" }); continue; }
    const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-70);
    const key = `${trip.prefix}inbox/${person}/${day}/${stamp}-${randomUUID().slice(0, 4)}-${clean}`;
    out.push({ name, key, url: presignPut(key) });
  }
  return json({ files: out });
};
