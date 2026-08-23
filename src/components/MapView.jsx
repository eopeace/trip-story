import { useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Lightbox from "./Lightbox";
import StoryCard from "./StoryCard";
import { DAYS, DAY_BY_DATE, PLACE_BY_KEY, url, gmaps } from "../data/trip";

const DAY_COLOR = ["#8C7B6B", "#C1633F", "#4E8C86", "#E0A93B", "#8A6FA3", "#C98B8B", "#7A8C4E"];

const placeIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">📍</div>',
  iconSize: [22, 22], iconAnchor: [11, 20],
});

function Fit({ bounds }) {
  const map = useMap();
  useMemo(() => { if (bounds) map.fitBounds(bounds, { padding: [40, 40] }); }, [bounds]);
  return null;
}

const storyIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">📖</div>',
  iconSize: [20, 20], iconAnchor: [10, 18],
});

export default function MapView({ media, stories = [] }) {
  const [day, setDay] = useState("all");
  const [lb, setLb] = useState(null);

  const pts = useMemo(() => media.filter((m) => m.gps &&
    (day === "all" || DAY_BY_DATE[m.dt.slice(0, 10)] === day)), [media, day]);

  // group photos taken within ~40m of each other
  const clusters = useMemo(() => {
    const map = new Map();
    pts.forEach((m) => {
      const key = m.gps[0].toFixed(3) + "," + m.gps[1].toFixed(3);
      if (!map.has(key)) map.set(key, { lat: m.gps[0], lon: m.gps[1], items: [] });
      map.get(key).items.push(m);
    });
    return [...map.values()];
  }, [pts]);

  const route = useMemo(() =>
    pts.filter((m) => m.k === "image").map((m) => m.gps), [pts]);

  const bounds = useMemo(() => {
    const c = clusters.filter((c) => c.lon < 20); // fit on Europe, ignore the pins from home
    const src = c.length ? c : clusters;
    return src.length ? L.latLngBounds(src.map((c) => [c.lat, c.lon])) : null;
  }, [clusters]);

  const mediaByName = useMemo(
    () => Object.fromEntries(media.map((m) => [m.f, m])), [media]);

  // stories that name a place, grouped so several stories share one marker
  const storyPins = useMemo(() => {
    const out = new Map();
    stories.forEach((st) => {
      const p = st.placeKey ? PLACE_BY_KEY[st.placeKey] : null;
      if (!p) return;
      if (day !== "all" && st.dayId && st.dayId !== day) return;
      if (!out.has(p.en)) out.set(p.en, { place: p, items: [] });
      out.get(p.en).items.push(st);
    });
    return [...out.values()];
  }, [stories, day]);

  const days = day === "all" ? DAYS : DAYS.filter((d) => d.id === day);
  const dayIdx = (id) => DAYS.findIndex((d) => d.id === id);

  return (
    <section className="section" id="map">
      <h2>המפה</h2>
      <p className="lead">{clusters.length} נקודות · {pts.length} תמונות עם מיקום{storyPins.length ? ` · ${storyPins.length} מקומות עם סיפור` : ""}</p>

      <div className="filters">
        <span className="lbl">יום:</span>
        <button className={"fbtn" + (day === "all" ? " on" : "")} onClick={() => setDay("all")}>הכול</button>
        {DAYS.map((d, i) => (
          <button key={d.id} className={"fbtn" + (day === d.id ? " on" : "")} onClick={() => setDay(d.id)}>
            {i + 1} · {d.city}
          </button>
        ))}
      </div>

      <div className="mapbox">
        <MapContainer center={[48.19, 16.6]} zoom={9} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap'
          />
          <Fit bounds={bounds} />
          {day !== "all" && route.length > 1 && (
            <Polyline positions={route} pathOptions={{ color: DAY_COLOR[dayIdx(day)] || "#C1633F", weight: 3, opacity: .6, dashArray: "6 8" }} />
          )}
          {clusters.map((c, i) => {
            const d = DAY_BY_DATE[c.items[0].dt.slice(0, 10)];
            return (
              <CircleMarker key={i} center={[c.lat, c.lon]}
                radius={Math.min(20, 7 + Math.sqrt(c.items.length) * 2.4)}
                pathOptions={{ color: "#fff", weight: 2, fillColor: DAY_COLOR[dayIdx(d)] || "#C1633F", fillOpacity: .85 }}>
                <Popup>
                  <div className="pin-pop">
                    <img src={url("thumbs/" + (c.items.find((x) => x.k === "image") || c.items[0]).f)} alt="" />
                    <div>{c.items.length} פריטים · {new Date(c.items[0].dt).toLocaleDateString("he-IL")}</div>
                    <button className="chip" style={{ marginTop: 6 }} onClick={() => setLb({ list: c.items, i: 0 })}>פתיחה</button>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
          {days.flatMap((d) => d.places.map((p, k) => (
            <Marker key={d.id + k} position={[p.lat, p.lon]} icon={placeIcon}>
              <Popup>
                <div className="pin-pop">
                  <b>{p.he}</b><br />
                  <a href={gmaps(p)} target="_blank" rel="noreferrer">פתיחה ב-Google Maps</a>
                </div>
              </Popup>
            </Marker>
          )))}
          {storyPins.map((sp) => (
            <Marker key={"s" + sp.place.en} position={[sp.place.lat, sp.place.lon]} icon={storyIcon}>
              <Popup maxWidth={320}>
                <div className="pin-pop stories">
                  <b>{sp.place.he}</b>
                  {sp.items.map((st) => (
                    <StoryCard key={st.id} it={st} mediaByName={mediaByName} compact
                      onOpen={(v) => setLb({ list: v.list, i: v.i })} />
                  ))}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {lb && <Lightbox list={lb.list} index={lb.i}
        setIndex={(f) => setLb((s) => ({ ...s, i: typeof f === "function" ? f(s.i) : f }))}
        onClose={() => setLb(null)} />}
    </section>
  );
}
