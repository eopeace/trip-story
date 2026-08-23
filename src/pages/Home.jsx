import { go } from "../lib/router";

export default function Home({ user, live, handle }) {
  return (
    <>
      <header className="hero">
        <div className="wrap">
          <h1>הטיול שלכם,<br />סיפור שאפשר להראות</h1>
          <p className="sub">
            כולם מוסיפים תמונות מהטלפון שלהם. אנחנו מסדרים לפי ימים, מקומות ואנשים,
            ומכינים אתר אחד לשלוח למשפחה.
          </p>
          <div className="statrow">
            <div className="stat"><b>1</b><span>קישור לכל הקבוצה</span></div>
            <div className="stat"><b>0</b><span>אפליקציות להוריד</span></div>
            <div className="stat"><b>∞</b><span>תמונות בערימה</span></div>
          </div>
          <p style={{ marginTop: "1.5rem" }}>
            {user
              ? <button className="btn" onClick={() => go("/new")}>יצירת טיול חדש</button>
              : <button className="btn" disabled={!live} onClick={() => live?.login()}>כניסה עם Google</button>}
            {user && handle && (
              <button className="btn ghost" style={{ marginInlineStart: ".6rem" }}
                onClick={() => go(`/${handle}`)}>הטיולים שלי</button>
            )}
          </p>
        </div>
      </header>

      <main className="wrap">
        <section className="section">
          <h2>איך זה עובד</h2>
          <ul>
            <li><b>פותחים טיול</b> — שם ותאריכים. דקה.</li>
            <li><b>שולחים קישור</b> לקבוצת הוואטסאפ. כל אחד מעלה מהטלפון שלו.</li>
            <li><b>מקבלים אתר</b> — ימים, מפה, גלריה, וסיפורים שכולם יכולים לכתוב.</li>
          </ul>
          <p className="note">
            התמונות נשלחות ישירות מהטלפון, כך שהתאריך והמיקום נשמרים — בדיוק מה
            שוואטסאפ מוחק.
          </p>
        </section>
      </main>
    </>
  );
}
