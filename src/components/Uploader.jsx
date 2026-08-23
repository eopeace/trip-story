import { useState } from "react";

const BATCH = 40;
const fmt = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

const readName = () => {
  try { return localStorage.getItem("vt-name") || ""; } catch { return ""; }
};

/** one file straight to storage, with a progress bar - fetch() cannot report progress */
function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve() : reject(new Error(`שגיאה ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("החיבור נקטע"));
    xhr.send(file);
  });
}

/**
 * Adding photos to one trip. The link itself is the permission - no account, no app.
 * Files go straight from the phone to storage, which is what keeps the date and the
 * place inside each photo; anything that passes through a chat app loses both.
 */
export default function Uploader({ token, days = [], tripId = "", tripPath = "" }) {
  const [name, setName] = useState(readName);
  const [files, setFiles] = useState([]);
  const [day, setDay] = useState("");
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(0);

  const mark = (key, patch) =>
    setState((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));

  function pick(e) {
    setFiles([...e.target.files]);
    setState({}); setErr(""); setDone(0);
  }

  function rememberName(v) {
    setName(v);
    try { localStorage.setItem("vt-name", v); } catch { /* private window */ }
  }

  async function send(e) {
    e.preventDefault();
    if (!files.length || busy || !name.trim()) return;
    setBusy(true); setErr(""); setDone(0);
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        const res = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token, name: name.trim(), day: day || "auto",
            files: chunk.map((f) => ({ name: f.name, size: f.size })),
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "השרת לא ענה");
        const { files: links } = await res.json();

        const queue = links.map((link, k) => ({ link, file: chunk[k] }));
        const workers = Array.from({ length: 3 }, async () => {
          while (queue.length) {
            const { link, file } = queue.shift();
            if (link.error) { mark(link.name, { error: link.error }); continue; }
            try {
              await put(link.url, file, (p) => mark(link.name, { pct: Math.round(p * 100) }));
              mark(link.name, { pct: 100, ok: true });
              setDone(++ok);
            } catch (ex) {
              mark(link.name, { error: ex.message });
            }
          }
        });
        await Promise.all(workers);
      }
    } catch (ex) {
      setErr(ex.message || "משהו השתבש");
    }
    // Remember that something was sent, so the trip page can say "yours are still
    // on the way" instead of looking empty for a quarter of an hour.
    if (ok && tripId) {
      try {
        localStorage.setItem(`ts-up-${tripId}`,
          JSON.stringify({ n: ok, at: new Date().toISOString() }));
      } catch { /* private window - the upload still worked */ }
    }
    setBusy(false);
  }

  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <form className="storyform" onSubmit={send}>
      <label className="uprow">
        <span>השם שלכם</span>
        <input type="text" value={name} onChange={(e) => rememberName(e.target.value)}
          placeholder="איך קוראים לכם?" maxLength={30} disabled={busy} />
      </label>

      <label className="uprow">
        <span>הקבצים</span>
        <input type="file" multiple accept="image/*,video/*" onChange={pick} disabled={busy} />
      </label>

      {days.length > 0 && (
        <>
          <label className="uprow">
            <span>איזה יום?</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} disabled={busy}>
              <option value="">לפי התאריך שבתמונה</option>
              {days.map((d, i) => (
                <option key={d.id} value={d.id}>יום {i + 1} · {d.date}{d.city ? ` · ${d.city}` : ""}</option>
              ))}
            </select>
          </label>
          <p className="note">
            אם לתמונה אין תאריך משלה — נשתמש ביום שבחרתם. אם יש לה תאריך, הוא תמיד גובר.
          </p>
        </>
      )}

      <p className="note">
        שלחו מגלריית התמונות של הטלפון, לא מוואטסאפ — ואטסאפ מוחק את התאריך והמיקום מכל תמונה.
        באייפון: לפני השליחה, Options ← Format: Current.
      </p>

      {files.length > 0 && (
        <div className="uplist">
          {files.map((f) => {
            const st = state[f.name] || {};
            return (
              <div className="upfile" key={f.name}>
                <span className="upname">{f.name}</span>
                <span className="upsize">{fmt(f.size)}</span>
                <span className="upstat">
                  {st.error ? <b className="bad">{st.error}</b>
                    : st.ok ? "✓" : st.pct ? `${st.pct}%` : ""}
                </span>
                <span className="upbar"><i style={{ width: `${st.pct || 0}%` }} /></span>
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="err">{err}</p>}

      <div className="storyrow">
        <button className="btn" disabled={!files.length || busy || !name.trim()}>
          {busy ? "מעלים…" : files.length ? `שליחה · ${files.length} קבצים · ${fmt(total)}` : "שליחה"}
        </button>
        {done > 0 && !busy && (
          <span className="who">עלו {done} קבצים. תודה!</span>
        )}
      </div>

      {done > 0 && !busy && (
        <div className="afterup">
          <b>מה קורה עכשיו</b>
          <p>
            אנחנו מסדרים את התמונות, מזהים מתי ואיפה צולמו, ומחפשים מי מופיע בהן.
            זה לוקח בדרך כלל עד רבע שעה.
          </p>
          {tripPath && <a className="btn" href={tripPath}>לצפייה בטיול</a>}
        </div>
      )}
    </form>
  );
}
