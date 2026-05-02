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

/** CSP désactivée (fonts / assets). CORP cross-origin : évite des blocages fetch / cookies en prod. */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors(corsOptions()));

const MONGODB_URI = process.env.MONGODB_URI;
const WHATSAPP_ORDER_NUMBER = process.env.WHATSAPP_ORDER_NUMBER
  ? String(process.env.WHATSAPP_ORDER_NUMBER).replace(/\D/g, "")
  : "22991180721";

const imageFileFilter = (_req, file, cb) => {
  const ok = /^image\//.test(file.mimetype);
  cb(ok ? null : new Error("Fichier image uniquement"), ok);
};

/** Images → MongoDB GridFS (local comme Vercel, pas de disque ni Vercel Blob). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

let mongoConnectPromise = null;

async function connectDB() {
  if (!MONGODB_URI || !String(MONGODB_URI).trim()) {
    throw new Error("MONGODB_URI non défini");
  }
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!mongoConnectPromise) {
    const t = isVercel ? 10000 : 20000;
    mongoConnectPromise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: t,
        connectTimeoutMS: t,
        socketTimeoutMS: isVercel ? 25000 : 45000,
        maxPoolSize: 10,
      })
      .catch((err) => {
        mongoConnectPromise = null;
        throw err;
      });
  }
  await mongoConnectPromise;
}

app.use(express.json({ limit: "2mb" }));
app.use(mongoSanitize({ replaceWith: "_" }));

/** Assets statiques avant les routes API */
app.use(express.static(path.join(__dirname, "public")));

/**
 * Connexion Mongo avant les routes qui en ont besoin.
 * Sur Vercel, la fonction serverless ne reçoit en pratique que /api/* ; certains runtimes
 * passent un chemin sans préfixe `/api` → on connecte toujours sur Vercel pour éviter
 * des requêtes sans connexion (buffer désactivé = hang/504).
 */
app.use(async (req, res, next) => {
  const pathname = String(req.originalUrl || req.url || req.path || "/").split("?")[0];
  const needsMongo = pathname.startsWith("/api") || isVercel;
  if (!needsMongo) {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (e) {
    if (!IS_PROD) console.error("MongoDB:", e.message);
    res.status(503).json({
      error: "Base de données indisponible. Vérifiez MONGODB_URI et le réseau Atlas.",
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState,
  });
});

app.get("/api/order-contact", (_req, res) => {
  res.json({ whatsapp: WHATSAPP_ORDER_NUMBER });
});

/** Fichiers image stockés dans MongoDB (GridFS). */
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
    if (IS_PROD) {
      return res.status(503).json({ error: "Envoi du fichier impossible pour le moment." });
    }
    return sendServerError(res, e);
  }
});

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
