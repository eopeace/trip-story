import { ACT_HE, DAYS, PEOPLE, PLACE_BY_KEY, url } from "../data/trip";

const byId = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

export function fmtDate(ts) {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/** Presentation only - deliberately free of any Firebase import, so the
 *  map and the itinerary can show stories without pulling in the SDK. */
export default function StoryCard({ it, mediaByName, user, onEdit, onRemove, onOpen, compact }) {
  const p = byId[it.personId];
  const day = DAYS.find((d) => d.id === it.dayId);
  const place = it.placeKey ? PLACE_BY_KEY[it.placeKey] : null;
  const pics = (it.photos || []).map((f) => mediaByName?.[f]).filter(Boolean);

  return (
    <article className={"story" + (compact ? " compact" : "")}
      style={{ borderInlineStartColor: p?.color || "#bbb" }}>
      <header>
        <b style={{ color: p?.color }}>{p?.he || it.authorName}</b>
        <span className="meta">
          {fmtDate(it.createdAt)}
          {place ? ` · ${place.he}` : ""}
          {!place && day ? ` · ${day.title}` : ""}
        </span>
      </header>
      <p>{it.text}</p>

      {(it.activities || []).length > 0 && (
        <div className="chips small">
          {it.activities.map((a) => <span className="chip" key={a}>{ACT_HE[a] || a}</span>)}
        </div>
      )}

      {pics.length > 0 && (
        <div className="picrow read">
          {pics.map((m, i) => (
            <button type="button" key={m.f} className="pic"
              onClick={() => onOpen && onOpen({ list: pics, i })}>
              <img src={url(m.k === "video" ? m.poster : "thumbs/" + m.f)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {!compact && user?.email?.toLowerCase() === it.authorEmail && (
        <div className="storyacts">
          <button onClick={() => onEdit(it)}>עריכה</button>
          <button onClick={() => onRemove(it.id)}>מחיקה</button>
        </div>
      )}
    </article>
  );
}
