/**
 * The whole server side of Trip Story, which is almost nothing:
 * one address that hands out upload links, and the built site for everything else.
 */
import { onRequest } from "../functions/api/upload-url.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/upload-url") return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
