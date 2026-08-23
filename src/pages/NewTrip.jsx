import { useState } from "react";
import { go } from "../lib/router";

const DOW = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const pad = (n) => String(n).padStart(2, "0");
const he = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

/** One day entry per calendar day. Places arrive later, from the photos themselves. */
function daysBetween(from, to) {
  const out = [];
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b) || b < a) return out;
  for (let d = new Date(a), i = 1; d <= b && i <= 60; d.setDate(d.getDate() + 1), i++) {
    out.push({
      id: `d${i}`, date: he(d), dow: DOW[d.getDay()], city: "",
      title: `יום ${i}`, blurb: "", items: [], places: [],
    });
  }
  return out;
}

export default function NewTrip({ user, live, handle, onHandle }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [wantHandle, setWantHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!user) {
    return (
      <main className="wrap"><section className="section">
        <h2>יצירת טיול</h2>
        <p className="lead">צריך להתחבר קודם — רק כדי שהטיול יהיה שלכם.</p>
        <button className="btn" disabled={!live} onClick={() => live?.login()}>כניסה עם Google</button>
      </section></main>
    );
  }

  // The account needs a name for the address bar before its first trip.
  if (!handle) {
    const suggestion = live ? live.slugify(user.displayName || user.email.split("@")[0]) : "";
    return (
      <main className="wrap"><section className="section">
        <h2>איך תיקראו בכתובת?</h2>
        <p className="lead">
          כל הטיולים שלכם יגורו תחת השם הזה, למשל <code>/{wantHandle || suggestion || "השם"}/vienna</code>.
        </p>
        <form className="storyform" onSubmit={async (e) => {
          e.preventDefault();
          const h = live.slugify(wantHandle || suggestion);
          if (!h) { setErr("צריך שם באותיות באנגלית"); return; }
          setBusy(true); setErr("");
          try { onHandle(await live.claimHandle(h, user)); }
          catch { setErr("השם הזה תפוס, נסו אחר"); }
          setBusy(false);
        }}>
          <label className="uprow">
            <span>השם</span>
            <input value={wantHandle} onChange={(e) => setWantHandle(e.target.value)}
              placeholder={suggestion} maxLength={40} />
          </label>
          {err && <p className="err">{err}</p>}
          <div className="storyrow"><button className="btn" disabled={busy}>אישור</button></div>
        </form>
      </section></main>
    );
  }

  async function create(e) {
    e.preventDefault();
    const s = live.slugify(slug || title);
    if (!title.trim() || !s) { setErr("צריך שם לטיול"); return; }
    const days = daysBetween(from, to);
    if (!days.length) { setErr("בדקו את התאריכים"); return; }
    setBusy(true); setErr("");
    try {
      await live.createTrip(user, handle, {
        slug: s, title: title.trim(),
        subtitle: "", days, people: [], editors: [],
      });
      go(`/${handle}/${s}`);
    } catch (ex) {
      setErr(ex.message === "exists" ? "כבר יש לכם טיול בשם הזה" : "היצירה נכשלה");
      setBusy(false);
    }
  }

  const preview = live ? live.slugify(slug || title) : "";

  return (
    <main className="wrap"><section className="section">
      <h2>טיול חדש</h2>
      <p className="lead">שם ותאריכים. את השאר נבנה מהתמונות עצמן.</p>
      <form className="storyform" onSubmit={create}>
        <label className="uprow">
          <span>שם הטיול</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="וינה וברטיסלבה 2026" maxLength={60} />
        </label>
        <label className="uprow">
          <span>כתובת</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)}
            placeholder="vienna" maxLength={40} />
        </label>
        <p className="note">הטיול יהיה בכתובת <code>/{handle}/{preview || "…"}</code></p>
        <label className="uprow">
          <span>מתאריך</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="uprow">
          <span>עד תאריך</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {err && <p className="err">{err}</p>}
        <div className="storyrow">
          <button className="btn" disabled={busy}>{busy ? "רגע…" : "יצירת הטיול"}</button>
        </div>
      </form>
    </section></main>
  );
}
