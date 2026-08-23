import { useState } from "react";
import Uploader from "./Uploader";
import { DAYS } from "../data/trip";

/** The owner's view: the link to hand out, and the same upload form for themselves. */
export default function Upload({ trip, live }) {
  const [token, setToken] = useState(trip.uploadToken);
  const [open, setOpen] = useState(trip.uploadOpen !== false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const link = token ? `${window.location.origin}/u/${token}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* older browser - the text is on screen anyway */ }
  }

  async function reset(nextOpen) {
    if (!live) return;
    setBusy(true);
    const t = await live.resetUploadLink({ ...trip, id: trip.id }, { open: nextOpen });
    setToken(t); setOpen(Boolean(t)); setBusy(false);
  }

  return (
    <section className="section">
      <h2>הוספת תמונות</h2>
      <p className="lead">שלחו את הקישור לכל מי שהיה בטיול. הם לא צריכים חשבון ולא אפליקציה.</p>

      <div className="sharebox">
        {open && token ? (
          <>
            <code className="link">{link}</code>
            <button className="btn" onClick={copy}>{copied ? "הועתק ✓" : "העתקת הקישור"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => reset(true)}>קישור חדש</button>
            <button className="btn ghost" disabled={busy} onClick={() => reset(false)}>סגירת ההעלאה</button>
          </>
        ) : (
          <>
            <span className="who">ההעלאה סגורה כרגע.</span>
            <button className="btn" disabled={busy} onClick={() => reset(true)}>פתיחת קישור חדש</button>
          </>
        )}
      </div>
      <p className="note">
        קישור חדש מבטל את הקודם. הקישור מאפשר להוסיף תמונות בלבד — לא לערוך את האתר.
      </p>

      {open && token && <Uploader token={token} days={DAYS}
        tripId={trip.id} tripPath={`/${trip.handle}/${trip.slug}`} />}
    </section>
  );
}
