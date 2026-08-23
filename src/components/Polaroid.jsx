import { useEffect, useState } from "react";
import { url } from "../data/trip";

/** Polaroid frame. If `items` has >1 photo it gently auto-cycles. */
export default function Polaroid({ items, caption, tilt = "tilt-a", interval = 4200, onClick, full = false }) {
  const list = items || [];
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => {
      setShown(false);
      setTimeout(() => setI((n) => (n + 1) % list.length), 450);
    }, interval);
    return () => clearInterval(t);
  }, [list.length, interval]);

  const m = list[i];
  if (!m) return null;
  const isVid = m.k === "video";
  // thumbnails are 420px, which goes soft once the tiles get big - at the
  // largest size load the real photo instead. Lazy loading keeps that honest:
  // only the tiles someone actually scrolls to are fetched.
  const src = isVid ? url(m.poster) : url((full ? "images/" : "thumbs/") + m.f);

  return (
    <figure className={"pola " + tilt} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="frame">
        <img
          src={src}
          alt={caption || ""}
          loading="lazy"
          className={shown ? "show" : ""}
          onLoad={() => setShown(true)}
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
        {isVid && <span className="play"><i>▶</i></span>}
      </div>
      {caption && <figcaption className="cap">{caption}</figcaption>}
    </figure>
  );
}
