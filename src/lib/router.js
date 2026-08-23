import { useEffect, useState } from "react";

/**
 * The whole router. Four shapes of address and nothing else:
 *   /                     the front page
 *   /new                  create a trip
 *   /u/<token>            add photos to one trip, no account needed
 *   /<handle>             someone's trips
 *   /<handle>/<slug>      a trip
 */
export function parse(path = window.location.pathname) {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!parts.length) return { page: "home" };
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "u") return { page: "upload", token: parts[1] || "" };
  if (parts.length === 1) return { page: "user", handle: parts[0].toLowerCase() };
  return { page: "trip", handle: parts[0].toLowerCase(), slug: parts[1].toLowerCase() };
}

export function go(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse());
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  return route;
}
