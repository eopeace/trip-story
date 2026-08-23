import { useEffect, useState } from "react";
import { queryWhere } from "../lib/fire-rest";
import { go } from "../lib/router";

export default function UserPage({ handle, user, live, myHandle }) {
  const [trips, setTrips] = useState(null);
  const mine = myHandle === handle;

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = mine && live && user
        ? await live.myTrips(user.uid)
        : await queryWhere("trips", "handle", handle);
      if (alive) setTrips(rows.filter((t) => mine || t.visibility !== "private"));
    })();
    return () => { alive = false; };
  }, [handle, mine, live, user]);

  return (
    <main className="wrap">
      <section className="section">
        <h2>{mine ? "הטיולים שלי" : `הטיולים של ${handle}`}</h2>
        {trips === null && <p className="lead">רגע…</p>}
        {trips && !trips.length && <p className="lead">עוד אין כאן טיולים.</p>}
        <div className="chips">
          {(trips || []).map((t) => (
            <button className="chip" key={t.id} onClick={() => go(`/${handle}/${t.slug}`)}>
              {t.title}
            </button>
          ))}
        </div>
        {mine && (
          <p style={{ marginTop: "1.2rem" }}>
            <button className="btn" onClick={() => go("/new")}>טיול חדש</button>
          </p>
        )}
      </section>
    </main>
  );
}
