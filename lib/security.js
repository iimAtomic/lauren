const rateLimit = require("express-rate-limit");

const IS_PROD = process.env.NODE_ENV === "production";

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

/** CORS : si CORS_ORIGINS est vide → tout le monde (nécessaire pour cookies en prod). Sinon liste stricte. */
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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };
}

/** Limites volontairement hautes pour ne pas bloquer un usage normal en prod */
/**
 * Derrière Vercel / proxy : express-rate-limit v8 sinon erreur (trust proxy + X-Forwarded-For).
 * false = désactive ces vérifs (voir EnabledValidations dans la doc du paquet).
 */
const rlValidateBehindProxy =
  process.env.VERCEL || process.env.TRUST_PROXY === "1"
    ? { trustProxy: false, xForwardedForHeader: false }
    : undefined;

function apiGeneralLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_API_MAX) || 3000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes. Réessayez dans quelques minutes." },
    ...(rlValidateBehindProxy ? { validate: rlValidateBehindProxy } : {}),
    skip: (req) => {
      const u = req.originalUrl || req.url || "";
      return u.startsWith("/api/health");
    },
  });
}

function apiAdminLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_ADMIN_MAX) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de tentatives sur cette action. Patientez avant de réessayer." },
    ...(rlValidateBehindProxy ? { validate: rlValidateBehindProxy } : {}),
  });
}

module.exports = {
  IS_PROD,
  LIMITS,
  sanitizeProductFields,
  sanitizeProductPatch,
  validationErrorForProduct,
  sendServerError,
  corsOptions,
  apiGeneralLimiter,
  apiAdminLimiter,
};
