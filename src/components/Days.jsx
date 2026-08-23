import { useMemo } from "react";
import Polaroid from "./Polaroid";
import StoryCard from "./StoryCard";
import { DAYS, DAY_BY_DATE, gmaps } from "../data/trip";

const TILTS = ["tilt-a", "tilt-b", "tilt-c"];

export default function Days({ media, stories = [], openDay }) {
  const byDay = {};
  media.forEach((m) => {
    const d = DAY_BY_DATE[m.dt.slice(0, 10)];
    if (d) (byDay[d] = byDay[d] || []).push(m);
  });

  const mediaByName = useMemo(
    () => Object.fromEntries(media.map((m) => [m.f, m])), [media]);
  const storiesByDay = useMemo(() => {
    const out = {};
    stories.forEach((s) => { if (s.dayId) (out[s.dayId] = out[s.dayId] || []).push(s); });
    return out;
  }, [stories]);

  return (
    <section className="section" id="days">
      <h2>המסלול, יום אחרי יום</h2>
      <p className="lead">10–16 באוגוסט 2026 · ברטיסלבה ווינה</p>
      {DAYS.map((d, i) => {
        const pics = (byDay[d.id] || []).filter((m) => m.k === "image");
        const pick = pics.filter((_, k) => k % Math.max(1, Math.ceil(pics.length / 8)) === 0).slice(0, 8);
        return (
          <article className="day" key={d.id}>
            <div>
              <div className="no">יום {i + 1}</div>
              <h2>{d.title}</h2>
              <div className="meta">{d.dow} · {d.date} · {d.city}</div>
              <p className="blurb">{d.blurb}</p>
              <ul>{d.items.map((t, k) => <li key={k}>{t}</li>)}</ul>
              <div className="chips">
                {d.places.map((p, k) => (
                  <a className="chip" key={k} href={gmaps(p)} target="_blank" rel="noreferrer">📍 {p.he}</a>
                ))}
                {pics.length > 0 && (
                  <button className="chip" onClick={() => openDay(d.id)}>
                    {(byDay[d.id] || []).length} תמונות וסרטונים
                  </button>
                )}
              </div>
              {(storiesByDay[d.id] || []).length > 0 && (
                <div className="daystories">
                  {storiesByDay[d.id].map((st) => (
                    <StoryCard key={st.id} it={st} mediaByName={mediaByName} compact />
                  ))}
                </div>
              )}
            </div>
            <div className="side">
              {pick.length > 0 && (
                <Polaroid items={pick} caption={d.city} tilt={TILTS[i % 3]}
                  interval={4000 + i * 250} onClick={() => openDay(d.id)} />
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
