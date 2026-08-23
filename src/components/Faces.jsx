import { useEffect, useMemo, useState } from "react";
import { PALETTE, R2 } from "../data/trip";
import { slugify } from "../live";

/**
 * "Who is this?" - the screen a brand new trip needs.
 *
 * The photo pipeline finds every face and puts the ones that look like the same
 * person together, but it cannot know any names: a new group has nobody to
 * compare against. So it hands the groups over here, largest first, and the
 * owner says who they are once. From then on that person is found everywhere,
 * including in photos that arrive later.
 *
 * Answers are written one document each, so two people can name faces at the
 * same time and nothing is lost.
 */

const cropUrl = (trip, path) => `${R2}/${trip.prefix || ""}${path}`;

export default function Faces({ trip, user, member, live }) {
  const [data, setData] = useState(undefined);   // undefined = still loading
  const [answers, setAnswers] = useState({});
  const [people, setPeople] = useState(trip.people || []);
  const [skipped, setSkipped] = useState({});    // "not now", this visit only
  const [naming, setNaming] = useState(null);    // group id whose name box is open
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`${R2}/${trip.prefix || ""}faces.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => alive && setData(d));
    return () => { alive = false; };
  }, [trip.prefix]);

  useEffect(() => {
    if (!live) return undefined;
    return live.subscribeFaceNames(trip.id, setAnswers);
  }, [live, trip.id]);

  useEffect(() => setPeople(trip.people || []), [trip.people]);

  const byId = useMemo(
    () => Object.fromEntries(people.map((p, i) => [p.id, { ...p, color: p.color || PALETTE[i % PALETTE.length] }])),
    [people],
  );

  const groups = data?.groups || [];
  const open = groups.filter((g) => !answers[g.id] && !skipped[g.id]);
  const done = groups.filter((g) => answers[g.id]);

  async function answer(gid, payload) {
    if (!live || !user) return;
    setBusy(gid); setErr("");
    try {
      await live.saveFaceName(trip.id, gid, { ...payload, by: user.email.toLowerCase() });
      setNaming(null); setTyped("");
    } catch {
      setErr("לא הצלחנו לשמור. נסו שוב.");
    } finally {
      setBusy(null);
    }
  }

  async function nameNew(gid) {
    const label = typed.trim();
    if (!label) return;
    const existing = people.find((p) => p.he === label);
    if (existing) return answer(gid, { person: existing.id });

    let id = slugify(label);
    if (!id || byId[id]) id = `p${people.length + 1}`;
    const person = { id, he: label, color: PALETTE[people.length % PALETTE.length] };
    setBusy(gid); setErr("");
    try {
      await live.addTripPerson(trip, person);
      setPeople((list) => [...list, person]);
    } catch {
      setBusy(null);
      setErr("לא הצלחנו להוסיף את השם לטיול.");
      return;
    }
    return answer(gid, { person: id });
  }

  if (!member) {
    return (
      <section className="section">
        <h2>מי בתמונות</h2>
        <p className="lead">רק מי שמנהל את הטיול יכול לתת שמות.</p>
      </section>
    );
  }

  if (data === undefined) {
    return <section className="section"><p className="lead">טוען פרצופים…</p></section>;
  }

  if (!data || (!groups.length && !Object.keys(data.named || {}).length)) {
    return (
      <section className="section">
        <h2>מי בתמונות</h2>
        <p className="lead">
          עוד לא עברנו על התמונות של הטיול. זה קורה מעצמו כל רבע שעה אחרי שמעלים
          תמונות — חזרו לכאן בהמשך.
        </p>
      </section>
    );
  }

  return (
    <section className="section" id="faces">
      <h2>מי בתמונות</h2>
      <p className="lead">
        {open.length
          ? `אספנו פרצופים שחוזרים בתמונות. תנו שם לכל אחד — פעם אחת — ונזהה אותו בכל שאר התמונות, וגם בתמונות שיעלו בהמשך.`
          : "נתתם שם לכל מי שמצאנו. תודה!"}
      </p>

      {(open.length > 0 || done.length > 0) && (
        <div className="filters">
          <span className="lbl">נותרו:</span>
          <span className="chip">{open.length} קבוצות</span>
          {done.length > 0 && <span className="chip">{done.length} כבר נקראו בשם</span>}
          {Object.keys(data.named || {}).length > 0 && (
            <span className="hint">
              מזוהים כבר: {Object.entries(data.named).map(([id, n]) => `${byId[id]?.he || id} (${n})`).join(" · ")}
            </span>
          )}
        </div>
      )}

      {err && <p className="lead err">{err}</p>}

      {open.map((g) => (
        <div className="facecard" key={g.id}>
          <div className="facestrip">
            {g.crops.map((c) => (
              <img key={c} src={cropUrl(trip, c)} alt="" loading="lazy" />
            ))}
          </div>
          <div className="faceask">
            <b>מי זה?</b>
            <span className="hint">{g.n} פעמים בתמונות</span>
          </div>
          <div className="chips">
            {people.map((p) => (
              <button key={p.id} className="fbtn" disabled={busy === g.id}
                style={{ borderColor: byId[p.id]?.color }}
                onClick={() => answer(g.id, { person: p.id })}>
                {p.he}
              </button>
            ))}
            {naming === g.id ? (
              <>
                <input className="namebox" autoFocus value={typed} placeholder="שם חדש"
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && nameNew(g.id)} />
                <button className="fbtn on" disabled={busy === g.id || !typed.trim()}
                  onClick={() => nameNew(g.id)}>שמירה</button>
                <button className="fbtn" onClick={() => { setNaming(null); setTyped(""); }}>ביטול</button>
              </>
            ) : (
              <button className="fbtn" onClick={() => { setNaming(g.id); setTyped(""); }}>+ שם חדש</button>
            )}
          </div>
          <div className="chips">
            <button className="fbtn ghost" disabled={busy === g.id}
              onClick={() => setSkipped((s) => ({ ...s, [g.id]: true }))}>לא עכשיו</button>
            <button className="fbtn ghost" disabled={busy === g.id}
              onClick={() => answer(g.id, { ignore: true })}>לא מישהו שאני מכיר</button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div className="facedone">
          <h3>מה שכבר סימנתם</h3>
          <p className="hint">
            השמות נכנסים לגלריה תוך רבע שעה בערך, יחד עם המעבר הבא על התמונות.
          </p>
          {done.map((g) => (
            <div className="facerow" key={g.id}>
              <div className="facestrip small">
                {g.crops.slice(0, 4).map((c) => <img key={c} src={cropUrl(trip, c)} alt="" loading="lazy" />)}
              </div>
              <span className="facename">
                {answers[g.id]?.ignore ? "לא נשמר" : (byId[answers[g.id]?.person]?.he || answers[g.id]?.person)}
              </span>
              <button className="fbtn" disabled={busy === g.id}
                onClick={() => live.clearFaceName(trip.id, g.id)}>שינוי</button>
            </div>
          ))}
        </div>
      )}

      {data.singles > 0 && (
        <p className="hint">
          יש עוד {data.singles} פרצופים שהופיעו פעם אחת בלבד. נחכה שיופיעו שוב לפני שנשאל עליהם.
        </p>
      )}
    </section>
  );
}
