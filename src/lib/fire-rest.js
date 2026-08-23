/**
 * Reading Firestore over plain HTTP, with no SDK.
 *
 * The trip's configuration is the page itself, so it has to arrive before the first
 * paint. Loading the Firebase SDK to fetch one document would put ~100 KB in front of
 * every visitor, including the grandmother opening a share link. The SDK still loads
 * later, in the background, for the live parts: sign-in, stories, tagging.
 */
import { firebaseConfig } from "../data/firebase-config";

const BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}`
  + "/databases/(default)/documents";

/** Firestore's REST format wraps every value in a type tag. Unwrap it. */
export function plain(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(plain);
  if ("mapValue" in v) return fields(v.mapValue.fields);
  return null;
}

export const fields = (f) =>
  Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, plain(v)]));

/** One document, or null when it does not exist or is not readable. */
export async function readDoc(path) {
  try {
    const res = await fetch(`${BASE}/${path}?key=${firebaseConfig.apiKey}`);
    if (!res.ok) return null;
    const doc = await res.json();
    return { id: doc.name.split("/").pop(), ...fields(doc.fields) };
  } catch {
    return null;
  }
}

/** Every document in a collection whose field equals a value. Read-only, no SDK. */
export async function queryWhere(collection, field, value, limit = 50) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: "EQUAL",
          value: { stringValue: value },
        },
      },
      limit,
    },
  };
  try {
    const res = await fetch(`${BASE}:runQuery?key=${firebaseConfig.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .filter((r) => r.document)
      .map((r) => ({ id: r.document.name.split("/").pop(), ...fields(r.document.fields) }));
  } catch {
    return [];
  }
}
