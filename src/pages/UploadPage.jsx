import { useEffect, useState } from "react";
import Uploader from "../components/Uploader";
import { readDoc } from "../lib/fire-rest";

/** What someone sees when they tap the link in the group chat. No account, no app. */
export default function UploadPage({ token }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = token ? await readDoc(`uploadTokens/${token}`) : null;
      if (!alive) return;
      if (!t || t.open === false) { setState({ loading: false, bad: true }); return; }
      const trip = t.tripId ? await readDoc(`trips/${t.tripId}`) : null;
      if (!alive) return;
      setState({ loading: false, title: trip?.title || t.title || "הטיול", days: trip?.days || [] });
    })();
    return () => { alive = false; };
  }, [token]);

  if (state.loading) return <main className="wrap"><section className="section"><p className="lead">רגע…</p></section></main>;

  if (state.bad) {
    return (
      <main className="wrap">
        <section className="section">
          <h2>הקישור הזה כבר לא פעיל</h2>
          <p className="lead">בקשו קישור חדש ממי ששלח לכם אותו.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="wrap">
      <section className="section">
        <h2>{state.title}</h2>
        <p className="lead">הוסיפו את התמונות והסרטונים שלכם מהטיול. זה הכול — אין הרשמה.</p>
      </section>
      <section className="section">
        <Uploader token={token} days={state.days} />
      </section>
    </main>
  );
}
