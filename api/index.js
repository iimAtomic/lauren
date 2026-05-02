const app = require("../server.js");
const serverless = require("serverless-http");

/**
 * Vercel réécrit /api/products vers /api/index?path=products.
 * Express doit recevoir /api/products, sinon il voit /api/index et aucune route ne matche.
 */
function restoreApiPath(req) {
  const host = req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const url = new URL(req.url || "/api/index", `${proto}://${host}`);

  if (url.pathname !== "/api/index") return;

  const routeMatches =
    req.headers["x-now-route-matches"] ||
    req.headers["x-vercel-route-matches"] ||
    "";
  const matchedPath = new URLSearchParams(String(routeMatches)).get("path") || "";
  const rawPath = url.searchParams.get("path") || matchedPath;
  url.searchParams.delete("path");

  const cleanPath = String(rawPath)
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  url.pathname = cleanPath ? `/api/${cleanPath}` : "/api";

  const qs = url.searchParams.toString();
  req.url = url.pathname + (qs ? `?${qs}` : "");
}

const handler = serverless(app);

module.exports = (req, res) => {
  restoreApiPath(req);
  return handler(req, res);
};
