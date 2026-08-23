import { useMemo, useState } from "react";
import { configured } from "../firebase";
import { ACTIVITIES, DAYS, DAY_BY_DATE, PLACES, PLACE_BY_KEY, photosNear, url } from "../data/trip";
import Lightbox from "./Lightbox";
import StoryCard from "./StoryCard";



/** built-in activities plus anything the family has invented in earlier stories */
export function vocabulary(stories) {
  const seen = new Map(ACTIVITIES.map((a) => [a.id, a.he]));
  stories.forEach((s) => (s.activities || []).forEach((a) => {
    if (!seen.has(a)) seen.set(a, a);
  }));
  return [...seen].map(([id, he]) => ({ id, he }));
}

export default function Stories({ trip, media = [], stories = [], user = null, member = false, live = null }) {
  const [text, setText] = useState("");
  const [dayId, setDayId] = useState("");
  const [placeKey, setPlaceKey] = useState("");
  const [acts, setActs] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lb, setLb] = useState(null);

  const email = user?.email?.toLowerCase() || null;
  const me = (trip.people || []).find((p) => p.email === email);
  const personId = me?.id || null;
  const canWrite = Boolean(member && live);
  const vocab = useMemo(() => vocabulary(stories), [stories]);

  const place = placeKey ? PLACE_BY_KEY[placeKey] : null;

  // photos offered for tagging: the ones taken at that place, or failing that, that day's
  const candidates = useMemo(() => {
    if (place) return photosNear(media, place);
    if (dayId) return media.filter((m) => DAY_BY_DATE[m.dt.slice(0, 10)] === dayId);
    return [];
  }, [media, place, dayId]);

  function reset() {
    setText(""); setDayId(""); setPlaceKey(""); setActs([]); setPhotos([]);
    setCustom(""); setEditing(null);
  }

  function pickPlace(key) {
    setPlaceKey(key);
    const p = key ? PLACE_BY_KEY[key] : null;
    if (p) {
      if (!dayId && p.days.length === 1) setDayId(p.days[0]);
      // suggest the place's own activities, without wiping anything already chosen
      setActs((cur) => [...new Set([...cur, ...p.acts])]);
    }
  }

  const toggle = (list, set, v) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function addCustom(e) {
    e.preventDefault();
    const v = custom.trim();
    if (!v) return;
    if (!acts.includes(v)) setActs([...acts, v]);
    setCustom("");
  }

  async function save(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy || !canWrite) return;
    setBusy(true); setErr("");
    const payload = {
      text: body,
      dayId: dayId || null,
      placeKey: placeKey || null,
      activities: acts,
      photos,
    };
    try {
      if (editing) {
        await live.editStory(trip.id, editing, payload);
      } else {
        await live.addStory(trip.id, {
          ...payload,
          personId,
          authorEmail: email,
          authorName: user.displayName || me?.he || "",
        });
      }
      reset();
    } catch {
      setErr("השמירה נכשלה. נסו שוב.");
    }
    setBusy(false);
  }

  async function remove(id) {
    if (!window.confirm("למחוק את הסיפור הזה?")) return;
    try { await live.removeStory(trip.id, id); }
    catch { setErr("המחיקה נכשלה"); }
  }

  function startEdit(it) {
    setEditing(it.id); setText(it.text);
    setDayId(it.dayId || ""); setPlaceKey(it.placeKey || "");
    setActs(it.activities || []); setPhotos(it.photos || []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const mediaByName = useMemo(
    () => Object.fromEntries(media.map((m) => [m.f, m])), [media]);

  return (
    <section className="section">
      <h2>הסיפורים</h2>
      <p className="lead">כל אחד מוסיף כאן זיכרון משלו</p>

      {!configured && <div className="soon"><p>החיבור לחשבון Google עוד לא הוגדר.</p></div>}

      {/* signing in happens once, in the gallery - no second place to do it */}
      {configured && !canWrite && (
        <p className="note">
          {user
            ? "החשבון הזה יכול לקרוא סיפורים אבל לא לכתוב."
            : "כדי לכתוב סיפור צריך להתחבר — הכניסה נמצאת בראש לשונית הגלריה."}
        </p>
      )}

      {err && <p className="err">{err}</p>}

      {canWrite && (
        <form className="storyform" onSubmit={save}>
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            rows={4} maxLength={2000} placeholder="מה קרה? מה זכור לכם מהרגע הזה?" />

          <div className="storyrow">
            <select value={dayId} onChange={(e) => setDayId(e.target.value)}>
              <option value="">בלי יום מסוים</option>
              {DAYS.map((d) => <option key={d.id} value={d.id}>{d.date} · {d.title}</option>)}
            </select>

            <select value={placeKey} onChange={(e) => pickPlace(e.target.value)}>
              <option value="">בלי מקום מסוים</option>
              {PLACES.map((p) => <option key={p.en} value={p.en}>{p.he}</option>)}
            </select>
          </div>

          <div className="tagpick">
            <span className="lbl">על מה זה?</span>
            {vocab.map((a) => (
              <button type="button" key={a.id}
                className={"fbtn" + (acts.includes(a.id) ? " on" : "")}
                onClick={() => toggle(acts, setActs, a.id)}>{a.he}</button>
            ))}
            <input className="tagnew" value={custom} maxLength={24}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(e); }}
              placeholder="נושא משלכם +" />
          </div>

          {candidates.length > 0 && (
            <div className="photopick">
              <span className="lbl">
                {place ? `תמונות מ${place.he}` : "תמונות מהיום הזה"} · {photos.length} נבחרו
              </span>
              <div className="picrow">
                {candidates.slice(0, 40).map((m) => (
                  <button type="button" key={m.f}
                    className={"pic" + (photos.includes(m.f) ? " on" : "")}
                    onClick={() => toggle(photos, setPhotos, m.f)}>
                    <img src={url(m.k === "video" ? m.poster : "thumbs/" + m.f)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="storyrow">
            <button className="btn" disabled={busy || !text.trim()}>
              {editing ? "עדכון" : "פרסום"}
            </button>
            {editing && <button type="button" className="btn ghost" onClick={reset}>ביטול</button>}
          </div>
        </form>
      )}

      {configured && stories.length === 0 && (
        <div className="soon"><p>עוד לא נכתב כאן כלום. תהיו הראשונים.</p></div>
      )}

      <div className="storylist">
        {stories.map((it) => (
          <StoryCard key={it.id} it={it} mediaByName={mediaByName} user={user}
            onEdit={startEdit} onRemove={remove} onOpen={setLb} />
        ))}
      </div>

      {lb && <Lightbox list={lb.list} index={lb.i}
        setIndex={(f) => setLb((s) => ({ ...s, i: typeof f === "function" ? f(s.i) : f }))}
        onClose={() => setLb(null)} />}
    </section>
  );
}
