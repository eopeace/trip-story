/**
 * One trip's shape, and the pure geography/time helpers built on it.
 *
 * The app shows exactly one trip at a time, so the current trip lives in module
 * bindings that `configure()` swaps. Importers get the live values because these
 * are ES module bindings, not copies. It is a deliberate shortcut: it kept the
 * single-trip components untouched when the site became multi-trip.
 */

export const R2 = "https://pub-d9baec70699749c0a8f1f101062796b4.r2.dev";

/** Media lives under a per-trip prefix. Vienna, the first trip, has none. */
export let PREFIX = "";
export const url = (p) => `${R2}/${PREFIX}${p}`;

export let TRIP = null;
export let DAYS = [];
export let PEOPLE = [];
export let DAY_BY_DATE = {};
export let PLACES = [];
export let PLACE_BY_KEY = {};
export let ACTIVITIES = [];
export let ACT_HE = {};

/** The starting vocabulary every trip gets. A trip may add to it, never lose it. */
export const BASE_ACTIVITIES = [
  { id: "food", he: "אוכל" },
  { id: "sweets", he: "קינוחים וגלידה" },
  { id: "museums", he: "מוזיאונים" },
  { id: "palaces", he: "ארמונות וכנסיות" },
  { id: "views", he: "נופים ותצפיות" },
  { id: "playground", he: "פארקים ומשחקים" },
  { id: "water", he: "ים, נהר ובריכה" },
  { id: "transport", he: "רכבות, חשמליות וסירות" },
  { id: "streets", he: "רחובות ושוטטות" },
  { id: "hotel", he: "המלון" },
  { id: "sleep", he: "ילדים ישנים" },
  { id: "night", he: "טיולי לילה" },
  { id: "funny", he: "רגעים מצחיקים" },
  { id: "selfies", he: "סלפי" },
];

/** Colours handed out to people in order, so a new trip never has to pick any. */
export const PALETTE = ["#C1633F", "#4E8C86", "#C98B8B", "#E0A93B", "#7A8C4E",
  "#8A6FA3", "#D2795E", "#5B7DA8", "#8C7B6B", "#6B8CA3", "#A36B6B", "#5E8C5E"];

const iso = (ddmmyyyy) => {
  const [d, m, y] = String(ddmmyyyy).split("-");
  return `${y}-${m}-${d}`;
};

/** Point the whole app at one trip. Call before rendering it. */
export function configure(trip) {
  TRIP = trip || null;
  PREFIX = trip?.prefix || "";
  DAYS = trip?.days || [];
  PEOPLE = (trip?.people || []).map((p, i) => ({ ...p, color: p.color || PALETTE[i % PALETTE.length] }));

  DAY_BY_DATE = Object.fromEntries(DAYS.map((d) => [iso(d.date), d.id]));

  const seen = new Map();
  DAYS.forEach((d) => (d.places || []).forEach((p) => {
    const cur = seen.get(p.en) || { ...p, days: [] };
    if (!cur.days.includes(d.id)) cur.days.push(d.id);
    seen.set(p.en, cur);
  }));
  PLACES = [...seen.values()];
  PLACE_BY_KEY = Object.fromEntries(PLACES.map((p) => [p.en, p]));

  const vocab = new Map(BASE_ACTIVITIES.map((a) => [a.id, a.he]));
  (trip?.activities || []).forEach((a) => vocab.set(a.id, a.he));
  ACTIVITIES = [...vocab].map(([id, he]) => ({ id, he }));
  ACT_HE = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a.he]));
  return TRIP;
}

export const gmaps = (p) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.en || p.he)}`;

/** metres between two lat/lon pairs */
export function metres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const la = a[0] * r, lb = b[0] * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const NEAR = 250; // metres - GPS indoors drifts, so keep this generous;
                        // the day check below is what actually separates nearby venues

/**
 * Photos taken at a place: close enough in distance AND shot on a day the place was
 * actually visited. The day check matters because four venues can sit within a couple
 * of hundred metres of each other, and distance alone cannot tell them apart.
 */
export function photosNear(media, place, radius = NEAR) {
  if (!place) return [];
  return media.filter((m) =>
    m.gps
    && metres(m.gps, [place.lat, place.lon]) <= radius
    && place.days.includes(DAY_BY_DATE[m.dt.slice(0, 10)]));
}

/**
 * Activity tags per photo, worked out from where and when it was taken - no manual
 * tagging needed. A photo within 250m of a place inherits that place's activities;
 * anything shot between 20:00 and 05:00 counts as a night walk.
 */
export function deriveActivities(media) {
  const out = new Map();
  media.forEach((m) => {
    const set = new Set();
    const dayId = DAY_BY_DATE[m.dt.slice(0, 10)];
    if (m.gps) {
      PLACES.forEach((p) => {
        if (p.days.includes(dayId) && metres(m.gps, [p.lat, p.lon]) <= NEAR) {
          (p.acts || []).forEach((a) => set.add(a));
        }
      });
    }
    const hour = Number(m.dt.slice(11, 13));
    if (hour >= 20 || hour <= 5) set.add("night");
    out.set(m.f, set);
  });
  return out;
}
