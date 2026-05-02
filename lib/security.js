const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const IS_PROD = process.env.NODE_ENV === "production";

/** Limites strings pour limiter abus et payloads excessifs */
const LIMITS = {
  name: 200,
  description: 12000,
  image_url: 2048,
  category: 160,
  sub_category: 160,
};

function truncate(str, max) {
  if (str == null) return "";
  const s = String(str);
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Compare le mot de passe au secret (trim des deux côtés pour éviter les échecs
 * si ADMIN_KEY a un saut de ligne en fin de ligne sur Vercel).
 * Comparaison SHA-256 pour longueur fixe et éviter les fuites de timing sur la longueur.
 */
function timingSafeAdminMatch(provided, secret) {
  if (!secret || typeof secret !== "string") return false;
  const p = String(provided === undefined || provided === null ? "" : provided).trim();
  const s = String(secret).trim();
  if (!s) return false;
  const ah = crypto.createHash("sha256").update(p, "utf8").digest();
  const bh = crypto.createHash("sha256").update(s, "utf8").digest();
  try {
    return crypto.timingSafeEqual(ah, bh);
  } catch {
    return false;
  }
}

/** Payload création / mise à jour produit — coupe aux limites, types sûrs */
function sanitizeProductFields(body) {
  const b = body && typeof body === "object" ? body : {};
  const price = Number(b.price);
  return {
    name: truncate(b.name, LIMITS.name),
    description: truncate(b.description, LIMITS.description),
    image_url: truncate(b.image_url, LIMITS.image_url),
    category: truncate(b.category, LIMITS.category),
    sub_category: truncate(b.sub_category, LIMITS.sub_category),
    price: Number.isFinite(price) ? Math.max(0, price) : 0,
  };
}

/** PATCH produit : uniquement les champs envoyés, même sanitization */
function sanitizeProductPatch(body) {
  const b = body && typeof body === "object" ? body : {};
  const out = {};
  if (b.name !== undefined) out.name = truncate(b.name, LIMITS.name);
  if (b.description !== undefined) out.description = truncate(b.description, LIMITS.description);
  if (b.image_url !== undefined) out.image_url = truncate(b.image_url, LIMITS.image_url);
  if (b.category !== undefined) out.category = truncate(b.category, LIMITS.category);
  if (b.sub_category !== undefined) out.sub_category = truncate(b.sub_category, LIMITS.sub_category);
  if (b.price !== undefined) {
    const price = Number(b.price);
    out.price = Number.isFinite(price) ? Math.max(0, price) : 0;
  }
  return out;
}

function validationErrorForProduct(createFields) {
  if (!String(createFields.name || "").trim()) {
    return "Le nom du produit est obligatoire.";
  }
  return null;
}

function sendServerError(res, err) {
  if (!IS_PROD && err) console.error("[api]", err.message || err);
  return res.status(500).json({
    error: IS_PROD ? "Erreur serveur." : String(err?.message || "Erreur serveur."),
  });
}

function corsOptions() {
  const raw = process.env.CORS_ORIGINS;
  const allowlist = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    origin(origin, callback) {
      if (allowlist.length === 0) {
        return callback(null, true);
      }
      if (!origin || allowlist.includes(origin)) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  };
}

/** Limite générale API lecture / usages légers */
function apiGeneralLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_API_MAX) || 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes. Réessayez dans quelques minutes." },
    skip: (req) => {
      const u = req.originalUrl || req.url || "";
      return u.startsWith("/api/health");
    },
  });
}

/** Routes sensibles (écriture admin, brute-force clé) */
function apiAdminLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_ADMIN_MAX) || 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de tentatives sur cette action. Patientez avant de réessayer." },
  });
}

/** Tentatives de connexion admin (anti brute-force) */
function adminLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de tentatives de connexion. Réessayez plus tard." },
  });
}

module.exports = {
  IS_PROD,
  LIMITS,
  timingSafeAdminMatch,
  sanitizeProductFields,
  sanitizeProductPatch,
  validationErrorForProduct,
  sendServerError,
  corsOptions,
  apiGeneralLimiter,
  apiAdminLimiter,
  adminLoginLimiter,
};
