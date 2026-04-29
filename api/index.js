/**
 * Vercel : toutes les routes /api/* sont exécutées ici (Express via serverless-http).
 * Les pages et assets statiques viennent du dossier public/ (CDN Vercel).
 */
const serverless = require("serverless-http");
const app = require("../server.js");

module.exports = serverless(app);
