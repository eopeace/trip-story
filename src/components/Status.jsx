import { useEffect, useState } from "react";
import { R2 } from "../data/trip";

/**
 * One honest line about what the site is busy with.
 *
 * Photos do not appear the moment they are sent - they are sorted, dated, placed
 * and searched for faces by a job that wakes up every quarter of an hour. Without
 * something on screen saying so, a trip looks broken for fifteen minutes. The
 * browser remembers when it last sent photos; the job writes down when it last
 * looked. Comparing the two is enough to say which of the two states we are in.
 */

const readSent = (tripId) => {
  try { return JSON.parse(localStorage.getItem(`ts-up-${tripId}`) || "null"); }
  catch { return null; }
};

export function clearSent(tripId) {
  try { localStorage.removeItem(`ts-up-${tripId}`); } catch { /* fine */ }
}

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!isFinite(mins) || mins < 0) return "";
  if (mins < 2) return "ממש עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const h = Math.round(mins / 60);
  if (h < 24) return `לפני ${h} שעות`;
  return `לפני ${Math.round(h / 24)} ימים`;
}

export default function Status({ trip, member = false, onFaces }) {
  const [s, setS] = useState(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${R2}/${trip.prefix || ""}status.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => alive && setS(d));
    load();
    // While photos are on their way, look again now and then so the line changes
    // by itself instead of needing a reload.
    const t = setInterval(() => { setTick((n) => n + 1); load(); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [trip.prefix]);

  if (s === undefined) return null;

  const sent = readSent(trip.id);
  const waiting = sent && (!s?.at || sent.at > s.at);

  if (waiting) {
    return (
      <div className="status busy" key={tick}>
        <span className="dot" />
        <span>
          <b>{sent.n} קבצים שהוספתם בדרך.</b> מסדרים אותם, מזהים מתי ואיפה צולמו
          ומחפשים מי מופיע בהם — בדרך כלל עד רבע שעה. אפשר לסגור את הדף ולחזור.
        </span>
      </div>
    );
  }

  if (!s) return null;
  if (sent) clearSent(trip.id);

  return (
    <div className="status">
      <span>עודכן {ago(s.at)}</span>
      {s.photos > 0 && <span>{s.photos} תמונות</span>}
      {member && s.pending > 0 && (
        <button className="linkish" onClick={() => onFaces?.()}>
          {s.pending} פרצופים מחכים לשם ←
        </button>
      )}
    </div>
  );
}
