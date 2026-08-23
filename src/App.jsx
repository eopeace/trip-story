import { Suspense, lazy, useEffect, useState } from "react";
import { useRoute, go } from "./lib/router";
import { readDoc } from "./lib/fire-rest";
import Home from "./pages/Home";
import UploadPage from "./pages/UploadPage";
import "./styles.css";

const Trip = lazy(() => import("./pages/Trip"));
const NewTrip = lazy(() => import("./pages/NewTrip"));
const UserPage = lazy(() => import("./pages/UserPage"));

const Wait = () => <main className="wrap"><section className="section"><p className="lead">רגע…</p></section></main>;

export default function App() {
  const route = useRoute();
  const [live, setLive] = useState(null);
  const [user, setUser] = useState(null);
  const [handle, setHandle] = useState(null);
  const [trip, setTrip] = useState(undefined);   // undefined = still looking

  // Firebase arrives after the first paint. Everything on screen before that is
  // read over plain HTTP, so a visitor never waits for the SDK.
  useEffect(() => {
    let stop;
    import("./live").then((mod) => {
      setLive(mod);
      stop = mod.subscribeUser(setUser);
    }).catch(() => {});
    return () => stop && stop();
  }, []);

  useEffect(() => {
    if (!live || !user) { setHandle(null); return; }
    live.myHandle(user.uid).then(setHandle).catch(() => setHandle(null));
  }, [live, user]);

  useEffect(() => {
    if (route.page !== "trip") { setTrip(undefined); return undefined; }
    let alive = true;
    setTrip(undefined);
    readDoc(`trips/${route.handle}__${route.slug}`).then((t) => alive && setTrip(t));
    return () => { alive = false; };
  }, [route.page, route.handle, route.slug]);

  if (route.page === "upload") return <UploadPage token={route.token} />;
  if (route.page === "home") return <Home user={user} live={live} handle={handle} />;

  if (route.page === "new") {
    return (
      <Suspense fallback={<Wait />}>
        <NewTrip user={user} live={live} handle={handle} onHandle={setHandle} />
      </Suspense>
    );
  }

  if (route.page === "user") {
    return (
      <Suspense fallback={<Wait />}>
        <UserPage handle={route.handle} user={user} live={live} myHandle={handle} />
      </Suspense>
    );
  }

  if (trip === undefined) return <Wait />;
  if (!trip) {
    return (
      <main className="wrap"><section className="section">
        <h2>לא מצאנו את הטיול הזה</h2>
        <p className="lead">אולי הכתובת השתנתה, או שהטיול פרטי.</p>
        <button className="btn" onClick={() => go("/")}>לדף הבית</button>
      </section></main>
    );
  }

  return (
    <Suspense fallback={<Wait />}>
      <Trip trip={trip} user={user} live={live} />
    </Suspense>
  );
}
