/**
 * Everything that talks to Firestore while the page is open: sign-in, stories,
 * photo tags, and creating or editing trips. Loaded after first paint, so the
 * Firebase SDK never delays the page itself.
 */
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, addDoc, deleteDoc, getDoc, getDocs, onSnapshot, orderBy,
  query, where, serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { auth, db, configured } from "./firebase";

export { login, logout } from "./firebase";

/** Firestore document ids cannot contain "/" - filenames here never do, but be safe. */
export const idFor = (file) => file.replace(/\//g, "_");

const rnd = (n = 22) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
};

export const tripDocId = (handle, slug) => `${handle}__${slug}`;

/** A name that can live in an address bar: latin letters, digits and dashes. */
export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/* ------------------------------------------------------------------ watching */

export function subscribeUser(cb) {
  if (!configured) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

export function subscribeStories(tripId, cb) {
  if (!configured || !tripId) { cb([]); return () => {}; }
  const q = query(collection(db, "trips", tripId, "stories"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
}

export function subscribePhotoTags(tripId, cb) {
  if (!configured || !tripId) { cb({}); return () => {}; }
  return onSnapshot(collection(db, "trips", tripId, "photoTags"),
    (s) => cb(Object.fromEntries(s.docs.map((d) => [d.data().file || d.id, d.data()]))),
    () => cb({}));
}

/* -------------------------------------------------------------------- writing */

export function savePhotoTags(tripId, file, data, email) {
  const clean = {
    file,
    people: data.people || [],
    acts: data.acts || [],
    placeKey: data.placeKey || null,
    dayId: data.dayId || null,
    by: email,
    at: serverTimestamp(),
  };
  const ref = doc(db, "trips", tripId, "photoTags", idFor(file));
  const empty = !clean.people.length && !clean.acts.length && !clean.placeKey && !clean.dayId;
  return empty ? deleteDoc(ref) : setDoc(ref, clean);
}

export const addStory = (tripId, payload) =>
  addDoc(collection(db, "trips", tripId, "stories"), { ...payload, createdAt: serverTimestamp() });
export const editStory = (tripId, id, payload) =>
  updateDoc(doc(db, "trips", tripId, "stories", id), payload);
export const removeStory = (tripId, id) =>
  deleteDoc(doc(db, "trips", tripId, "stories", id));

/* ---------------------------------------------------------------- accounts */

/** The account's name in the address bar. Created once, on the first trip. */
export async function myHandle(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data().handle || null : null;
}

export async function handleFree(handle) {
  const snap = await getDoc(doc(db, "handles", handle));
  return !snap.exists();
}

export async function claimHandle(handle, user) {
  if (!(await handleFree(handle))) throw new Error("taken");
  await setDoc(doc(db, "handles", handle), { uid: user.uid });
  await setDoc(doc(db, "users", user.uid), {
    handle, email: user.email.toLowerCase(), name: user.displayName || "", at: serverTimestamp(),
  }, { merge: true });
  return handle;
}

/* ------------------------------------------------------------------- trips */

export async function createTrip(user, handle, {
  slug, title, subtitle, days = [], people = [], editors = [],
  activities = [], dates = "", footer = "", prefix = null,
}) {
  const id = tripDocId(handle, slug);
  if ((await getDoc(doc(db, "trips", id))).exists()) throw new Error("exists");
  const mediaId = rnd(20);
  const token = rnd(22);
  const trip = {
    ownerUid: user.uid, handle, slug, title, subtitle: subtitle || "",
    dates, footer, days, people, activities,
    editors: [user.email.toLowerCase(), ...editors.map((e) => e.toLowerCase())],
    prefix: prefix === null ? `t/${mediaId}/` : prefix,
    mediaId, uploadToken: token, uploadOpen: true,
    visibility: "link",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "trips", id), trip);
  // so the pipeline can get from a storage prefix back to the trip it belongs to
  await setDoc(doc(db, "mediaIndex", mediaId), { tripId: id, ownerUid: user.uid });
  await setDoc(doc(db, "uploadTokens", token), {
    tripId: id, mediaId, prefix: trip.prefix, title, ownerUid: user.uid, open: true,
  });
  return { id, ...trip };
}

export const updateTrip = (tripId, patch) =>
  updateDoc(doc(db, "trips", tripId), { ...patch, updatedAt: serverTimestamp() });

export async function myTrips(uid) {
  const q = query(collection(db, "trips"), where("ownerUid", "==", uid));
  const s = await getDocs(q);
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Turn the sharing link off, or issue a fresh one. The old link stops working. */
export async function resetUploadLink(trip, { open = true } = {}) {
  if (trip.uploadToken) {
    await setDoc(doc(db, "uploadTokens", trip.uploadToken), { open: false }, { merge: true });
  }
  if (!open) {
    await updateTrip(trip.id, { uploadOpen: false });
    return null;
  }
  const token = rnd(22);
  await setDoc(doc(db, "uploadTokens", token), {
    tripId: trip.id, mediaId: trip.mediaId, prefix: trip.prefix,
    title: trip.title, ownerUid: trip.ownerUid, open: true,
  });
  await updateTrip(trip.id, { uploadToken: token, uploadOpen: true });
  return token;
}


/* --------------------------------------------------- one-off: the first trip */

/**
 * The Vienna trip was built before there were accounts, so its media sits at the
 * root of the bucket and its stories live in their own collections. This copies it
 * into the shape every later trip uses, without moving a single file.
 */
export async function importSeed(user, seed) {
  await claimHandle(seed.handle, user).catch(() => {});
  const trip = await createTrip(user, seed.handle, seed);

  let moved = 0;
  if (seed.legacy?.stories) {
    const old = await getDocs(collection(db, seed.legacy.stories));
    for (const d of old.docs) {
      await setDoc(doc(db, "trips", trip.id, "stories", d.id), d.data());
      moved += 1;
    }
  }
  if (seed.legacy?.photoTags) {
    const old = await getDocs(collection(db, seed.legacy.photoTags));
    for (const d of old.docs) {
      await setDoc(doc(db, "trips", trip.id, "photoTags", d.id), d.data());
      moved += 1;
    }
  }
  return { trip, moved };
}
