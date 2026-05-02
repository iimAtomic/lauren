const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const mongoose = require("mongoose");
const multer = require("multer");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const Product = require("./models/Product");
const SiteSettings = require("./models/SiteSettings");
const {
  timingSafeAdminMatch,
  sanitizeProductFields,
  sanitizeProductPatch,
  validationErrorForProduct,
  sendServerError,
  corsOptions,
  apiGeneralLimiter,
  apiAdminLimiter,
  adminLoginLimiter,
  IS_PROD,
} = require("./lib/security");

/** Durée de session admin : 1 h après connexion (cookie + entrée MongoDB) */
const ADMIN_SESSION_MS = 60 * 60 * 1000;

const isVercel = Boolean(process.env.VERCEL);
const DEFAULT_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=85",
  "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=85",
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85",
  "https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=900&q=85",
];

function mergeHeroImages(stored) {
  const out = [...DEFAULT_HERO_IMAGES];
  if (!stored || !Array.isArray(stored)) return out;
  for (let i = 0; i < 4; i++) {
    const u = stored[i] != null ? String(stored[i]).trim() : "";
    if (u) out[i] = u;
  }
  return out;
}

function normalizeHeroInput(arr) {
  if (!Array.isArray(arr)) return ["", "", "", ""];
  const row = arr.slice(0, 4).map((s) => (s != null ? String(s).trim() : ""));
  while (row.length < 4) row.push("");
  return row;
}

const DEFAULT_SHOP_CATEGORIES = [
  { slug: "body", label: "Body care" },
  { slug: "face", label: "Face care" },
  { slug: "box", label: "Box" },
];

function slugifyCategory(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeShopCategoriesInput(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const label = row.label != null ? String(row.label).trim() : "";
    let slug = row.slug != null ? slugifyCategory(row.slug) : "";
    if (!slug && label) slug = slugifyCategory(label);
    if (!slug || !label) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, label });
  }
  return out;
}

/** Boutique : liste vide explicite = pas de pastilles ; absent (vieilles données) = défauts */
function mergeShopCategories(stored) {
  if (stored === undefined || stored === null) {
    return DEFAULT_SHOP_CATEGORIES.map((c) => ({ ...c }));
  }
  if (!Array.isArray(stored)) return DEFAULT_SHOP_CATEGORIES.map((c) => ({ ...c }));
  if (stored.length === 0) return [];
  return normalizeShopCategoriesInput(stored);
}

const app = express();
app.disable("x-powered-by");

if (process.env.VERCEL || process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors(corsOptions()));

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;
const WHATSAPP_ORDER_NUMBER = process.env.WHATSAPP_ORDER_NUMBER
  ? String(process.env.WHATSAPP_ORDER_NUMBER).replace(/\D/g, "")
  : "22991180721";

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!isVercel) {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch (e) {
    if (!IS_PROD) console.warn("Impossible de créer public/uploads :", e.message);
  }
}

const imageFileFilter = (_req, file, cb) => {
  const ok = /^image\//.test(file.mimetype);
  cb(ok ? null : new Error("Fichier image uniquement"), ok);
};

let upload;
if (isVercel) {
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });
} else {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
  upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });
}

async function connectDB() {
  if (!MONGODB_URI || !String(MONGODB_URI).trim()) {
    throw new Error("MONGODB_URI non défini");
  }
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await mongoose.connect(MONGODB_URI, {
    /** Sur Vercel le plafond fonction est court : échouer vite plutôt que 504 */
    serverSelectionTimeoutMS: isVercel ? 8000 : 10000,
    maxPoolSize: isVercel ? 5 : 10,
  });
}

function resolveSessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && String(s).trim().length >= 24) {
    return String(s).trim();
  }
  if (!IS_PROD) {
    return "__mm_local_dev_only_change_me__not_for_production__";
  }
  const admin = ADMIN_KEY && String(ADMIN_KEY).trim();
  if (admin) {
    return crypto.createHash("sha256").update("mm-admin-session-v1|" + admin, "utf8").digest("hex");
  }
  return crypto
    .createHash("sha256")
    .update("mm-emergency-session|" + String(process.env.VERCEL_URL || "default"), "utf8")
    .digest("hex");
}

app.use(express.json({ limit: "2mb" }));
app.use(mongoSanitize({ replaceWith: "_" }));

/** Assets statiques avant session/cookies : évite que le CSS soit retardé ou bloqué par MongoStore */
app.use(express.static(path.join(__dirname, "public")));

/** Connexion Mongoose avant les routes /api (sessions incluses) pour limiter les délais cumulés */
app.use(async (req, res, next) => {
  const pathname = String(req.originalUrl || req.url || req.path || "/").split("?")[0];
  if (!pathname.startsWith("/api")) {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (e) {
    if (!IS_PROD) console.error("MongoDB:", e.message);
    res.status(500).json({ error: "Service temporairement indisponible." });
  }
});

app.use(
  session({
    name: "mm_admin",
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      maxAge: ADMIN_SESSION_MS,
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "strict",
      path: "/",
    },
    store: MONGODB_URI
      ? MongoStore.create({
          mongoUrl: String(MONGODB_URI).trim(),
          ttl: ADMIN_SESSION_MS / 1000,
        })
      : undefined,
  })
);

app.use("/api", apiGeneralLimiter());

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  return res.status(401).json({
    error: IS_PROD ? "Non autorisé." : "Session expirée ou accès non autorisé. Reconnectez-vous.",
  });
}

app.get("/api/admin/session", (req, res) => {
  if (req.session && req.session.admin === true) {
    if (IS_PROD) {
      return res.json({ authenticated: true });
    }
    const created = req.session.createdAt || 0;
    return res.json({
      authenticated: true,
      expiresAt: created + ADMIN_SESSION_MS,
    });
  }
  res.json({ authenticated: false });
});

app.post("/api/admin/login", adminLoginLimiter(), (req, res) => {
  const pwd = req.body && req.body.password;
  const pwdStr =
    pwd === undefined || pwd === null ? "" : String(pwd).slice(0, 1024);
  if (!ADMIN_KEY || !String(ADMIN_KEY).trim()) {
    return res.status(503).json({ error: "Service temporairement indisponible." });
  }
  if (!timingSafeAdminMatch(pwdStr, ADMIN_KEY)) {
    return res.status(401).json({ error: "Identifiants invalides." });
  }
  req.session.regenerate((regErr) => {
    if (regErr) return sendServerError(res, regErr);
    req.session.admin = true;
    req.session.createdAt = Date.now();
    req.session.save((saveErr) => {
      if (saveErr) return sendServerError(res, saveErr);
      if (IS_PROD) {
        return res.json({ ok: true });
      }
      res.json({ ok: true, expiresInSeconds: ADMIN_SESSION_MS / 1000 });
    });
  });
});

app.post("/api/admin/logout", (req, res) => {
  if (!req.session) {
    return res.json({ ok: true });
  }
  req.session.destroy((err) => {
    if (err) return sendServerError(res, err);
    res.clearCookie("mm_admin", {
      path: "/",
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
});

app.get("/api/health", (_req, res) => {
  if (IS_PROD) {
    return res.json({ ok: true });
  }
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.get("/api/order-contact", (_req, res) => {
  res.json({ whatsapp: WHATSAPP_ORDER_NUMBER });
});

app.get("/api/site-settings", async (_req, res) => {
  try {
    const doc = await SiteSettings.findOne().lean();
    res.json({
      heroImages: mergeHeroImages(doc?.heroImages),
      shopCategories: mergeShopCategories(doc?.shopCategories),
    });
  } catch (e) {
    return sendServerError(res, e);
  }
});

app.get("/api/site-settings/raw", apiAdminLimiter(), requireAdmin, async (_req, res) => {
  try {
    const doc = await SiteSettings.findOne().lean();
    const row = normalizeHeroInput(doc?.heroImages);
    const rawCats = doc?.shopCategories;
    const shopCategories =
      rawCats === undefined || rawCats === null
        ? DEFAULT_SHOP_CATEGORIES.map((c) => ({ ...c }))
        : Array.isArray(rawCats)
          ? normalizeShopCategoriesInput(rawCats)
          : [];
    res.json({ heroImages: row, shopCategories });
  } catch (e) {
    return sendServerError(res, e);
  }
});

app.put("/api/site-settings", apiAdminLimiter(), requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const $set = {};
    if (body.heroImages !== undefined) {
      $set.heroImages = normalizeHeroInput(body.heroImages);
    }
    if (body.shopCategories !== undefined) {
      $set.shopCategories = normalizeShopCategoriesInput(body.shopCategories);
    }
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "Aucun champ à mettre à jour (heroImages ou shopCategories)." });
    }
    const doc = await SiteSettings.findOneAndUpdate({}, { $set }, { new: true, upsert: true });
    res.json({
      heroImages: mergeHeroImages(doc.heroImages),
      shopCategories: mergeShopCategories(doc.shopCategories),
    });
  } catch (e) {
    res.status(400).json({ error: IS_PROD ? "Données invalides." : e.message });
  }
});

app.get("/api/products", async (_req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(products);
  } catch (e) {
    return sendServerError(res, e);
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: "ID invalide." });
  }
});

app.post("/api/products", apiAdminLimiter(), requireAdmin, async (req, res) => {
  try {
    const fields = sanitizeProductFields(req.body);
    const ve = validationErrorForProduct(fields);
    if (ve) return res.status(400).json({ error: ve });
    const doc = await Product.create(fields);
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ error: IS_PROD ? "Données invalides." : e.message });
  }
});

app.put("/api/products/:id", apiAdminLimiter(), requireAdmin, async (req, res) => {
  try {
    const patch = sanitizeProductPatch(req.body);
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Aucun champ valide à mettre à jour." });
    }
    const p = await Product.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: IS_PROD ? "Données invalides." : e.message });
  }
});

app.delete("/api/products/:id", apiAdminLimiter(), requireAdmin, async (req, res) => {
  try {
    const p = await Product.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: IS_PROD ? "Requête invalide." : e.message });
  }
});

app.post(
  "/api/upload",
  apiAdminLimiter(),
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier reçu." });
      }

      if (isVercel) {
        const buf = req.file.buffer;
        if (!buf || !Buffer.isBuffer(buf)) {
          return res.status(400).json({ error: "Fichier invalide." });
        }
        const { put } = require("@vercel/blob");
        const rawExt = path.extname(req.file.originalname || "") || ".jpg";
        const safeExt = /^\.[a-z0-9]{1,8}$/i.test(rawExt) ? rawExt.toLowerCase() : ".jpg";
        const pathname = `uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
        const blob = await put(pathname, buf, {
          access: "public",
          contentType: req.file.mimetype || "image/jpeg",
          ...(process.env.BLOB_READ_WRITE_TOKEN
            ? { token: process.env.BLOB_READ_WRITE_TOKEN }
            : {}),
        });
        return res.json({ url: blob.url });
      }

      const url = `/uploads/${req.file.filename}`;
      return res.json({ url });
    } catch (e) {
      if (IS_PROD) {
        return res.status(503).json({ error: "Envoi du fichier impossible pour le moment." });
      }
      return sendServerError(res, e);
    }
  }
);

module.exports = app;

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        if (IS_PROD) return;
        const safeUri = String(MONGODB_URI || "").replace(
          /\/\/([^:]+):([^@]+)@/,
          "//$1:***@"
        );
        console.log("MongoDB connecté :", safeUri);
        console.log(`Maison Mona — http://localhost:${PORT}`);
        console.log(`Admin — http://localhost:${PORT}/admin.html`);
      });
    })
    .catch((err) => {
      if (IS_PROD) {
        console.error("Connexion base de données impossible.");
      } else {
        console.error("\n❌ Connexion MongoDB impossible.\n");
        if (String(MONGODB_URI).includes("127.0.0.1") || String(MONGODB_URI).includes("localhost")) {
          console.error(
            "→ MongoDB local n’est pas démarré, ou MONGODB_URI n’est pas chargé depuis .env.\n"
          );
        } else {
          console.error(
            "→ Vérifiez l’URI Atlas (Network Access → 0.0.0.0/0), le mot de passe et le nom de la base.\n"
          );
        }
        console.error(err.message || err);
      }
      process.exit(1);
    });
}
