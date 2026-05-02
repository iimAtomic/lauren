/**
 * Ping minimal — sans require de server.js, sans Mongo, sans Express.
 * Sert à valider que les fonctions Vercel s’exécutent du tout (pour diagnostiquer un 504 cold start).
 */
module.exports = (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      now: new Date().toISOString(),
      region: process.env.VERCEL_REGION || null,
      node: process.version,
    })
  );
};
