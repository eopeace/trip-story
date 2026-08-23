import { Suspense, lazy, useEffect, useState } from "react";
import Days from "../components/Days";
import Status from "../components/Status";
import Gallery from "../components/Gallery";
import MapView from "../components/MapView";
import { DAYS, PALETTE, R2, configure } from "../data/trip";
import { go } from "../lib/router";

const Stories = lazy(() => import("../components/Stories"));
const Upload = lazy(() => import("../components/Upload"));
const Faces = lazy(() => import("../components/Faces"));

const TABS = [
  ["days", "המסלול"],
  ["gallery", "גלריה"],
  ["map", "מפה"],
  ["stories", "סיפורים"],
];

const isMember = (trip, user) =>
  Boolean(user && (trip.editors || []).includes(user.email?.toLowerCase()));

export default function Trip({ trip, user, live }) {
  const [media, setMedia] = useState([]);
  const [wantTab, setTab] = useState("days");
  const [dayFilter, setDayFilter] = useState("all");
  const [stories, setStories] = useState([]);
  const [people, setPeople] = useState({});
  const [photoTags, setPhotoTags] = useState({});
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState(trip.people || []);

  configure(trip);

  // The list of photos lives beside the photos themselves, not in the database:
  // it is one file, it can be large, and it is rewritten whenever new media lands.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const base = `${R2}/${trip.prefix || ""}`;
    Promise.all([
      fetch(base + "manifest.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(base + "people-tags.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(([m, p]) => {
      if (!alive) return;
      setMedia(Array.isArray(m) ? m : []);
      setPeople(p || {});
      setLoading(false);
    });
    return () => { alive = false; };
  }, [trip.id, trip.prefix]);

  useEffect(() => {
    if (!live) return undefined;
    const stops = [
      live.subscribeStories(trip.id, setStories),
      live.subscribePhotoTags(trip.id, setPhotoTags),
    ];
    return () => stops.forEach((f) => f && f());
  }, [live, trip.id]);

  const member = isMember(trip, user);
  const tabs = member
    ? [...TABS, ["faces", "מי בתמונות"], ["upload", "הוספת תמונות"]]
    : TABS;
  const tab = !member && (wantTab === "upload" || wantTab === "faces") ? "days" : wantTab;

  const photos = media.filter((m) => m.k === "image").length;
  const videos = media.filter((m) => m.k === "video").length;
  const spots = new Set(media.filter((m) => m.gps)
    .map((m) => m.gps[0].toFixed(3) + m.gps[1].toFixed(3))).size;

  // A new trip starts with nobody in it. Whoever is tagging can add a name on the
  // spot, from the naming screen or from a photo, and it joins the trip for good.
  async function addPerson(label) {
    const name = String(label || "").trim();
    if (!name || !live || !user) return null;
    const found = roster.find((p) => p.he === name);
    if (found) return found;
    let id = live.slugify(name);
    if (!id || roster.some((p) => p.id === id)) id = `p${roster.length + 1}`;
    const person = { id, he: name, color: PALETTE[roster.length % PALETTE.length] };
    await live.addTripPerson({ ...trip, people: roster }, person);
    setRoster((list) => [...list, person]);
    return person;
  }

  const saveTags = (file, draft) =>
    live && user ? live.savePhotoTags(trip.id, file, draft, user.email.toLowerCase())
      : Promise.resolve();

  const openDay = (id) => {
    setDayFilter(id); setTab("gallery");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <nav className="nav">
        <div className="wrap">
          <button className="brand plain" onClick={() => go(`/${trip.handle}`)}>{trip.title}</button>
          {tabs.map(([k, t]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}</button>
          ))}
        </div>
      </nav>

      {tab === "days" && (
        <header className="hero">
          <div className="wrap">
            <h1>{trip.title}</h1>
            {trip.subtitle && <p className="sub">{trip.subtitle}</p>}
            {trip.dates && <div className="dates">{trip.dates}</div>}
            <div className="statrow">
              <div className="stat"><b>{photos}</b><span>תמונות</span></div>
              <div className="stat"><b>{videos}</b><span>סרטונים</span></div>
              <div className="stat"><b>{DAYS.length}</b><span>ימים</span></div>
              <div className="stat"><b>{spots}</b><span>נקודות במפה</span></div>
            </div>
          </div>
        </header>
      )}

      <main className="wrap">
        <Status trip={trip} member={member} onFaces={() => setTab("faces")} />

        {loading && <section className="section"><p className="lead">טוען את הטיול…</p></section>}

        {!loading && !media.length && tab !== "upload" && tab !== "faces" && (
          <section className="section">
            <h2>עוד אין כאן תמונות</h2>
            <p className="lead">
              {member
                ? "פתחו את “הוספת תמונות” ושלחו את הקישור לכל מי שהיה בטיול."
                : "בעל הטיול עוד לא הוסיף תמונות."}
            </p>
          </section>
        )}

        {tab === "days" && <Days media={media} stories={stories} openDay={openDay} />}
        {tab === "gallery" && (
          <Gallery media={media} stories={stories} people={people} photoTags={photoTags}
            user={user} member={member} saveTags={saveTags}
            roster={roster} addPerson={addPerson}
            dayFilter={dayFilter} setDayFilter={setDayFilter}
            login={live?.login} logout={live?.logout} />
        )}
        {tab === "map" && <MapView media={media} stories={stories} />}
        {tab === "upload" && (
          <Suspense fallback={<section className="section"><p className="lead">רגע…</p></section>}>
            <Upload trip={trip} live={live} />
          </Suspense>
        )}
        {tab === "faces" && (
          <Suspense fallback={<section className="section"><p className="lead">רגע…</p></section>}>
            <Faces trip={trip} user={user} member={member} live={live}
              roster={roster} addPerson={addPerson} />
          </Suspense>
        )}
        {tab === "stories" && (
          <Suspense fallback={<section className="section"><p className="lead">רגע…</p></section>}>
            <Stories trip={trip} media={media} stories={stories} user={user} member={member} live={live} />
          </Suspense>
        )}
      </main>

      <footer className="foot">{trip.footer || "נבנה באהבה"}</footer>
    </>
  );
}
