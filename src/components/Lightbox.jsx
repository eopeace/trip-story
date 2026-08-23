import { useEffect, useRef, useState } from "react";
import { ACTIVITIES, DAYS, PEOPLE, PLACES, url } from "../data/trip";

const EMPTY = { people: [], acts: [], placeKey: "", dayId: "" };

export default function Lightbox({ list, index, setIndex, onClose, canTag, tags = {}, onSaveTags }) {
  const m = list[index];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const touch = useRef(null);

  const go = (step) => setIndex((i) => (i + step + list.length) % list.length);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i - 1 + list.length) % list.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i + 1) % list.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [list.length, onClose, setIndex]);

  // stop the page behind from scrolling while a photo is open
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, []);

  // fetch the next and previous photo in the background so paging feels instant
  useEffect(() => {
    [1, -1].forEach((step) => {
      const n = list[(index + step + list.length) % list.length];
      if (n && n.k === "image") { const im = new Image(); im.src = url("images/" + n.f); }
    });
  }, [index, list]);

  // load whatever is already saved for this photo whenever we move to another one
  useEffect(() => {
    const t = m ? tags[m.f] : null;
    setDraft(t
      ? { people: t.people || [], acts: t.acts || [], placeKey: t.placeKey || "", dayId: t.dayId || "" }
      : EMPTY);
    setErr("");
  }, [m?.f, tags]);

  if (!m) return null;
  const when = new Date(m.dt).toLocaleString("he-IL", { dateStyle: "long", timeStyle: "short" });
  const saved = tags[m.f];
  const toggle = (key, v) => setDraft((d) => ({
    ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v],
  }));

  async function save(e) {
    e.stopPropagation();
    setBusy(true); setErr("");
    try { await onSaveTags(m.f, draft); }
    catch { setErr("השמירה נכשלה"); }
    setBusy(false);
  }

  // swiping sideways moves through the photos; a mostly-vertical drag is ignored
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const s0 = touch.current;
    if (!s0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    touch.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="lb" onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="x" onClick={onClose} aria-label="סגירה">×</button>
      <button className="arw prev" aria-label="הקודם"
        onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
      <button className="arw next" aria-label="הבא"
        onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>

      {m.k === "video" ? (
        <video src={url("videos/" + m.f)} poster={url(m.poster)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url("images/" + m.f)} alt="" decoding="async" onClick={(e) => e.stopPropagation()} />
      )}

      <div className="info">
        <span className="count">{index + 1} / {list.length}</span>
        {when}{m.est ? " (זמן משוער)" : ""}{m.gps ? " · יש מיקום" : ""}
        {canTag && (
          <button className="tagtoggle" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
            {open ? "סגירת תיוג" : saved ? "עריכת תיוג" : "תיוג התמונה"}
          </button>
        )}
      </div>

      {canTag && open && (
        <div className="tagpanel" onClick={(e) => e.stopPropagation()}>
          <div className="tagrow">
            <span className="lbl">מי בתמונה</span>
            {PEOPLE.map((p) => (
              <button key={p.id}
                className={"fbtn" + (draft.people.includes(p.id) ? " on" : "")}
                style={draft.people.includes(p.id)
                  ? { background: p.color, borderColor: p.color, color: "#fff" }
                  : { borderColor: p.color }}
                onClick={() => toggle("people", p.id)}>{p.he}</button>
            ))}
          </div>

          <div className="tagrow">
            <span className="lbl">איפה</span>
            <select value={draft.placeKey}
              onChange={(e) => setDraft((d) => ({ ...d, placeKey: e.target.value }))}>
              <option value="">לא ידוע</option>
              {PLACES.map((p) => <option key={p.en} value={p.en}>{p.he}</option>)}
            </select>
            <span className="lbl">יום</span>
            <select value={draft.dayId}
              onChange={(e) => setDraft((d) => ({ ...d, dayId: e.target.value }))}>
              <option value="">לא ידוע</option>
              {DAYS.map((d) => <option key={d.id} value={d.id}>{d.date} · {d.title}</option>)}
            </select>
          </div>

          <div className="tagrow">
            <span className="lbl">נושא</span>
            {ACTIVITIES.map((a) => (
              <button key={a.id} className={"fbtn" + (draft.acts.includes(a.id) ? " on" : "")}
                onClick={() => toggle("acts", a.id)}>{a.he}</button>
            ))}
          </div>

          <div className="tagrow end">
            {err && <span className="err">{err}</span>}
            {saved?.by && <span className="who">תויג על ידי {saved.by.split("@")[0]}</span>}
            <button className="btn" disabled={busy} onClick={save}>שמירה</button>
          </div>
        </div>
      )}
    </div>
  );
}
