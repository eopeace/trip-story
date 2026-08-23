import { useMemo, useState, useEffect, useRef } from "react";
import Polaroid from "./Polaroid";
import Lightbox from "./Lightbox";
import { ACT_HE, DAYS, DAY_BY_DATE, PEOPLE, deriveActivities } from "../data/trip";

const TILTS = ["tilt-a", "tilt-b", "tilt-c"];
const PAGE = 60;

/** Photo size in the grid, remembered per person per browser.
 *  The grid fills the row, so these are minimum widths - the real tile ends up
 *  wider. On a 1000px window that works out at roughly 4 / 2 / 1 across. */
const SIZES = [["220", "קטן"], ["380", "בינוני"], ["560", "גדול"]];
const DEFAULT_SIZE = "380";
const readSize = () => {
  try {
    const v = localStorage.getItem("vt-tile");
    return SIZES.some(([s]) => s === v) ? v : DEFAULT_SIZE;
  } catch { return DEFAULT_SIZE; }
};

export default function Gallery({ media, stories = [], people = {}, photoTags = {},
  user = null, member = false, saveTags, dayFilter, setDayFilter, login, logout }) {
  const [kind, setKind] = useState("all");
  const [act, setAct] = useState("all");
  const [who, setWho] = useState("all");
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [lb, setLb] = useState(-1);
  const [tile, setTile] = useState(readSize);
  const tail = useRef(null);

  function pickSize(v) {
    setTile(v);
    try { localStorage.setItem("vt-tile", v); } catch { /* private window - fine */ }
  }

  // activity tags: worked out from GPS + time of day, then topped up with
  // whatever the family tagged by hand when writing a story
  const tags = useMemo(() => {
    const t = deriveActivities(media);
    stories.forEach((st) => (st.photos || []).forEach((f) => {
      if (!t.has(f)) t.set(f, new Set());
      (st.activities || []).forEach((a) => t.get(f).add(a));
    }));
    Object.values(photoTags).forEach((pt) => {
      if (!pt.file) return;
      if (!t.has(pt.file)) t.set(pt.file, new Set());
      (pt.acts || []).forEach((a) => t.get(pt.file).add(a));
    });
    return t;
  }, [media, stories, photoTags]);

  // who is in each photo: the face-recognition pass, plus anything tagged by hand
  const faces = useMemo(() => {
    const f = {};
    Object.entries(people).forEach(([file, ids]) => { f[file] = new Set(ids); });
    Object.values(photoTags).forEach((pt) => {
      if (!pt.file) return;
      f[pt.file] = f[pt.file] || new Set();
      (pt.people || []).forEach((id) => f[pt.file].add(id));
    });
    return f;
  }, [people, photoTags]);

  const counts = useMemo(() => {
    const c = new Map();
    for (const set of tags.values()) for (const a of set) c.set(a, (c.get(a) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [tags]);

  const peopleCounts = useMemo(() => {
    const c = new Map();
    Object.values(faces).forEach((ids) => ids.forEach((id) => c.set(id, (c.get(id) || 0) + 1)));
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [faces]);

  const canTag = member;
  const untagged = (m) => !faces[m.f]?.size && !tags.get(m.f)?.size;

  const list = useMemo(() => media.filter((m) => {
    if (dayFilter !== "all" && DAY_BY_DATE[m.dt.slice(0, 10)] !== dayFilter) return false;
    if (kind !== "all" && m.k !== kind) return false;
    if (act !== "all" && !tags.get(m.f)?.has(act)) return false;
    if (who !== "all" && !faces[m.f]?.has(who)) return false;
    if (onlyUntagged && !untagged(m)) return false;
    return true;
  }), [media, dayFilter, kind, act, who, onlyUntagged, faces, tags]);

  useEffect(() => setLimit(PAGE), [dayFilter, kind, act, who, onlyUntagged]);

  // keep loading as you reach the bottom, instead of making people hunt for a button
  useEffect(() => {
    const el = tail.current;
    if (!el || limit >= list.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((l) => l + PAGE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, list.length]);

  return (
    <section className="section" id="gallery">
      <h2>הגלריה</h2>
      <p className="lead">{list.length} פריטים</p>

      <div className="authbar">
        {user ? (
          <>
            <span className="who">מחוברים כ־<b>{user.displayName || user.email}</b></span>
            <button className="btn ghost" onClick={() => logout?.()}>יציאה</button>
          </>
        ) : (
          <>
            <span className="who">התחברו כדי לתייג תמונות, לכתוב סיפורים ולהעלות תמונות משלכם</span>
            <button className="btn" disabled={!login} onClick={() => login?.()}>כניסה עם Google</button>
          </>
        )}
      </div>

      <div className="filters">
        <span className="lbl">יום:</span>
        <button className={"fbtn" + (dayFilter === "all" ? " on" : "")} onClick={() => setDayFilter("all")}>הכול</button>
        {DAYS.map((d, i) => (
          <button key={d.id} className={"fbtn" + (dayFilter === d.id ? " on" : "")}
            onClick={() => setDayFilter(d.id)} title={d.title}>{i + 1} · {d.city}</button>
        ))}
      </div>
      <div className="filters">
        <span className="lbl">סוג:</span>
        {[["all", "הכול"], ["image", "תמונות"], ["video", "סרטונים"]].map(([k, t]) => (
          <button key={k} className={"fbtn" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>{t}</button>
        ))}
      </div>

      <div className="filters">
        <span className="lbl">נושא:</span>
        <button className={"fbtn" + (act === "all" ? " on" : "")} onClick={() => setAct("all")}>הכול</button>
        {counts.map(([a, n]) => (
          <button key={a} className={"fbtn" + (act === a ? " on" : "")} onClick={() => setAct(a)}>
            {ACT_HE[a] || a} <i className="n">{n}</i>
          </button>
        ))}
      </div>

      {peopleCounts.length > 0 && (
        <div className="filters">
          <span className="lbl">מי בתמונה:</span>
          <button className={"fbtn" + (who === "all" ? " on" : "")} onClick={() => setWho("all")}>הכול</button>
          {peopleCounts.map(([id, n]) => {
            const p = PEOPLE.find((x) => x.id === id);
            return (
              <button key={id} className={"fbtn" + (who === id ? " on" : "")}
                onClick={() => setWho(id)}
                style={who === id ? { background: p?.color, borderColor: p?.color, color: "#fff" } : { borderColor: p?.color }}>
                {p?.he || id} <i className="n">{n}</i>
              </button>
            );
          })}
        </div>
      )}

      {canTag && (
        <div className="filters">
          <span className="lbl">תיוג:</span>
          <button className={"fbtn" + (onlyUntagged ? " on" : "")}
            onClick={() => setOnlyUntagged((v) => !v)}>
            רק מה שעוד לא תויג <i className="n">{media.filter(untagged).length}</i>
          </button>
          <span className="hint">פתחו תמונה כדי לתייג מי בה, איפה ומתי</span>
        </div>
      )}

      <div className="filters">
        <span className="lbl">גודל:</span>
        {SIZES.map(([v, t]) => (
          <button key={v} className={"fbtn" + (tile === v ? " on" : "")}
            onClick={() => pickSize(v)}>{t}</button>
        ))}
      </div>

      <div className="grid" style={{ "--tile": tile + "px" }}>
        {list.slice(0, limit).map((m, i) => (
          <Polaroid key={m.f} items={[m]} tilt={TILTS[i % 3]} onClick={() => setLb(i)} full={Number(tile) >= 380}
            caption={new Date(m.dt).toLocaleDateString("he-IL", { day: "numeric", month: "short" })} />
        ))}
      </div>
      <div ref={tail} />
      {limit < list.length && (
        <button className="more" onClick={() => setLimit((l) => l + PAGE)}>
          עוד {Math.min(PAGE, list.length - limit)} ↓
        </button>
      )}

      {lb >= 0 && <Lightbox list={list} index={lb} setIndex={setLb} onClose={() => setLb(-1)}
        canTag={canTag} tags={photoTags} onSaveTags={saveTags} />}
    </section>
  );
}
