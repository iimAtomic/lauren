const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const mongoose = require("mongoose");
const multer = require("multer");
const Product = require("./models/Product");
const SiteSettings = require("./models/SiteSettings");
const { saveImageBuffer, publicUrlPath, streamImageById } = require("./lib/gridfs");
const {
  sanitizeProductFields,
  sanitizeProductPatch,
  validationErrorForProduct,
  sendServerError,
  corsOptions,
  IS_PROD,
} = require("./lib/security");

const isVercel = Boolean(process.env.VERCEL);
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.set("strictQuery", true);
/** Pas de mise en attente des commandes : si Mongo n’est pas prêt, on échoue net (pas de hang silencieux → 504). */
mongoose.set("bufferCommands", false);
const WHATSAPP_ORDER_NUMBER = process.env.WHATSAPP_ORDER_NUMBER
  ? String(process.env.WHATSAPP_ORDER_NUMBER).replace(/\D/g, "")
  : "22991180721";

const DEFAULT_HERO_IMAGES = [
  "/uploads/MAKE8243.JPG",
  "/uploads/MAKE8338.JPG",
  "/uploads/MAKE8414.JPG",
  "/uploads/MAKE8440.JPG",
];

const DEFAULT_SHOP_CATEGORIES = [
  { slug: "body", label: "Body care" },
  { slug: "face", label: "Face care" },
  { slug: "box", label: "Box" },
];

function mergeHeroImages(stored) {
  const out = [...DEFAULT_HERO_IMAGES];
  if (!Array.isArray(stored)) return out;
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
    const label = row.label != null ? String(row.label).trim().slice(0, 160) : "";
    let slug = row.slug != null ? slugifyCategory(row.slug) : "";
    if (!slug && label) slug = slugifyCategory(label);
    if (!slug || !label) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug: slug.slice(0, 160), label });
  }
  return out;
}

/** Boutique : liste vide explicite = pas de pastilles ; absent (vieilles données) = défauts. */
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
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors(corsOptions()));

const imageFileFilter = (_req, file, cb) => {
  const ok = /^image\//.test(file.mimetype);
  cb(ok ? null : new Error("Fichier image uniquement"), ok);
};

/**
 * Images → MongoDB (GridFS).
 * 4 Mo max : la limite Vercel pour le body d’une fonction serverless est ~4,5 Mo —
 * au-delà la passerelle rejette la requête AVANT multer (réponse opaque).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

/** Réutilisé entre invocations Vercel (warm) — évite de reconnecter à chaque requête. */
const G = globalThis;
const MONGO_PROMISE_KEY = "__maisonMonaMongoConnect__";
const MONGO_STATS_KEY = "__maisonMonaMongoStats__";

if (!G[MONGO_STATS_KEY]) {
  G[MONGO_STATS_KEY] = { lastConnectMs: null, connects: 0, lastError: null };
}

async function connectDB() {
  if (!MONGODB_URI || !String(MONGODB_URI).trim()) {
    throw new Error("MONGODB_URI non défini");
  }
  if (mongoose.connection.readyState === 1) return;
  if (!G[MONGO_PROMISE_KEY]) {
    /** Plafond Vercel Hobby ~10s. On vise large pour la 1re connexion (cold + DNS SRV). */
    const t = isVercel ? 8000 : 20000;
    const t0 = Date.now();
    G[MONGO_PROMISE_KEY] = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: t,
        connectTimeoutMS: t,
        socketTimeoutMS: isVercel ? 20000 : 45000,
        maxPoolSize: isVercel ? 5 : 10,
        appName: "maison-mona",
      })
      .then((m) => {
        G[MONGO_STATS_KEY].lastConnectMs = Date.now() - t0;
        G[MONGO_STATS_KEY].connects += 1;
        G[MONGO_STATS_KEY].lastError = null;
        return m;
      })
      .catch((err) => {
        G[MONGO_STATS_KEY].lastError = String(err && err.message ? err.message : err);
        delete G[MONGO_PROMISE_KEY];
        throw err;
      });
  }
  await G[MONGO_PROMISE_KEY];
}

/** Garantit qu’un handler répond en JSON avant le plafond Vercel (504 sinon). */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${label} > ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Statique toujours activé.
 * Important : si Vercel route accidentellement "/" vers Express, Express sert quand même le site.
 */
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json({ limit: "2mb" }));
app.use(mongoSanitize({ replaceWith: "_" }));

/** Routes qui DOIVENT répondre instantanément, sans attendre Mongo. */
const NO_MONGO_PATHS = new Set([
  "/api/health",
  "/api/order-contact",
]);

app.get("/api/health", (_req, res) => {
  const stats = G[MONGO_STATS_KEY] || {};
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState,
    region: process.env.VERCEL_REGION || null,
    cold: !mongoose.connection.readyState,
    connectMs: stats.lastConnectMs,
    connects: stats.connects,
    lastError: stats.lastError,
    isVercel,
    nodeEnv: process.env.NODE_ENV || null,
  });
});

app.get("/api/order-contact", (_req, res) => {
  res.json({ whatsapp: WHATSAPP_ORDER_NUMBER });
});

app.use(async (req, res, next) => {
  const raw = String(req.originalUrl || req.url || "/");
  const pathname = raw.split("?")[0];
  const needsMongo =
    (pathname.startsWith("/api") || pathname.startsWith("api/") || raw.includes("/api/")) &&
    !NO_MONGO_PATHS.has(pathname);
  if (!needsMongo) return next();
  try {
    await connectDB();
    next();
  } catch (e) {
    if (!IS_PROD) console.error("MongoDB:", e.message);
    res.status(503).json({
      error: "Base de données indisponible. Réessayez dans quelques secondes.",
    });
  }
});

/** Diagnostic 504 : timings précis (DNS, connexion Mongo, ping). À lire depuis le navigateur. */
app.get("/api/debug/timing", async (_req, res) => {
  const out = { region: process.env.VERCEL_REGION || null, steps: [] };
  const stamp = (label, ms) => out.steps.push({ label, ms });
  try {
    const t0 = Date.now();
    await connectDB();
    stamp("connectDB", Date.now() - t0);

    const t1 = Date.now();
    await mongoose.connection.db.admin().ping();
    stamp("ping", Date.now() - t1);

    const t2 = Date.now();
    await SiteSettings.findOne().lean();
    stamp("findOne(SiteSettings)", Date.now() - t2);

    out.ok = true;
    res.json(out);
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message ? e.message : e);
    res.status(500).json(out);
  }
});

/** Image stockée dans MongoDB (GridFS). */
app.get("/api/media/:id", async (req, res) => {
  try {
    await streamImageById(req.params.id, res);
  } catch (e) {
    if (!IS_PROD) console.error("[media]", e);
    if (!res.headersSent) res.status(500).end();
  }
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

app.get("/api/site-settings/raw", async (_req, res) => {
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

app.put("/api/site-settings", async (req, res) => {
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
      return res
        .status(400)
        .json({ error: "Aucun champ à mettre à jour (heroImages ou shopCategories)." });
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID invalide." });
    }
    const p = await Product.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json(p);
  } catch (_e) {
    res.status(400).json({ error: "ID invalide." });
  }
});

app.post("/api/products", async (req, res) => {
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

app.put("/api/products/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID invalide." });
    }
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

app.delete("/api/products/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID invalide." });
    }
    const p = await Product.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: IS_PROD ? "Requête invalide." : e.message });
  }
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier reçu." });
    }
    const buf = req.file.buffer;
    if (!buf || !Buffer.isBuffer(buf)) {
      return res.status(400).json({ error: "Fichier invalide." });
    }
    const id = await saveImageBuffer(buf, req.file.originalname, req.file.mimetype);
    return res.json({ url: publicUrlPath(id) });
  } catch (e) {
    if (!IS_PROD) console.error("[upload]", e);
    return res.status(503).json({ error: "Envoi du fichier impossible pour le moment." });
  }
});

/** Admin : un seul appel (un seul cold start) au lieu de /raw + /products. */
app.get("/api/admin/bootstrap", async (_req, res) => {
  /** Plafond interne sous le plafond Vercel pour répondre en JSON 503 plutôt qu’un 504 opaque. */
  const internalCap = isVercel ? 8500 : 25000;
  try {
    const data = await withTimeout(
      Promise.all([
        SiteSettings.findOne().lean(),
        Product.find().sort({ createdAt: -1 }).lean(),
      ]),
      internalCap,
      "bootstrap"
    );
    const [doc, products] = data;
    const row = normalizeHeroInput(doc?.heroImages);
    const rawCats = doc?.shopCategories;
    const shopCategories =
      rawCats === undefined || rawCats === null
        ? DEFAULT_SHOP_CATEGORIES.map((c) => ({ ...c }))
        : Array.isArray(rawCats)
          ? normalizeShopCategoriesInput(rawCats)
          : [];
    res.json({ heroImages: row, shopCategories, products });
  } catch (e) {
    if (!IS_PROD) console.error("[bootstrap]", e);
    return res.status(503).json({
      error:
        "Base de données trop lente à répondre. Région Atlas / région Vercel à vérifier (voir /api/debug/timing).",
    });
  }
});

/** Fallback site : si une URL non-API arrive jusqu’à Express, on sert l’accueil. */
app.get("*", (req, res, next) => {
  const pathname = String(req.path || "/");
  if (pathname.startsWith("/api")) return next();
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * Gestionnaire d’erreurs final : Multer (fichier trop gros, type non image), JSON invalide, etc.
 * Sans ça, Express renvoie une page HTML qui casse les .json() côté admin.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (!err) return res.status(500).json({ error: "Erreur serveur." });
  if (!IS_PROD) console.error("[err]", err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Fichier trop volumineux (4 Mo max)." });
    }
    return res.status(400).json({ error: "Téléversement invalide." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON invalide." });
  }
  if (err.message === "Fichier image uniquement") {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({
    error: IS_PROD ? "Erreur serveur." : String(err.message || err),
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  /** En dev : on active aussi express.static APRES la définition de l’app, déjà fait plus haut. */
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
        if (
          String(MONGODB_URI).includes("127.0.0.1") ||
          String(MONGODB_URI).includes("localhost")
        ) {
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
