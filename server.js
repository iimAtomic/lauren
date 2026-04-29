const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const Product = require("./models/Product");
const SiteSettings = require("./models/SiteSettings");

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

const app = express();
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
    console.warn("Impossible de créer public/uploads :", e.message);
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
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: isVercel ? 5 : 10,
  });
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(async (req, res, next) => {
  const pathname = req.path || "/";
  if (!pathname.startsWith("/api")) {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (e) {
    console.error("MongoDB:", e.message);
    res.status(500).json({
      error:
        "Base de données indisponible. Définissez MONGODB_URI dans les variables d’environnement Vercel (Atlas : IP 0.0.0.0/0).",
    });
  }
});

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.adminKey;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Clé admin invalide ou absente." });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.get("/api/order-contact", (_req, res) => {
  res.json({ whatsapp: WHATSAPP_ORDER_NUMBER });
});

app.get("/api/site-settings", async (_req, res) => {
  try {
    const doc = await SiteSettings.findOne().lean();
    res.json({ heroImages: mergeHeroImages(doc?.heroImages) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/site-settings/raw", requireAdmin, async (_req, res) => {
  try {
    const doc = await SiteSettings.findOne().lean();
    const row = normalizeHeroInput(doc?.heroImages);
    res.json({ heroImages: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/site-settings", requireAdmin, async (req, res) => {
  try {
    const row = normalizeHeroInput(req.body?.heroImages);
    const doc = await SiteSettings.findOneAndUpdate(
      {},
      { heroImages: row },
      { new: true, upsert: true }
    );
    res.json({ heroImages: mergeHeroImages(doc.heroImages) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/products", async (_req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

app.post("/api/products", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const doc = await Product.create({
      name: body.name,
      image_url: body.image_url || "",
      description: body.description || "",
      category: body.category || "",
      sub_category: body.sub_category || "",
      price: Number(body.price) || 0,
    });
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const p = await Product.findByIdAndUpdate(
      req.params.id,
      {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.image_url !== undefined && { image_url: body.image_url }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.sub_category !== undefined && { sub_category: body.sub_category }),
        ...(body.price !== undefined && { price: Number(body.price) || 0 }),
      },
      { new: true, runValidators: true }
    );
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const p = await Product.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ error: "Produit introuvable." });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post(
  "/api/upload",
  requireAdmin,
  (req, res, next) => {
    if (isVercel) {
      return res.status(503).json({
        error:
          "L’upload de fichiers n’est pas disponible sur Vercel (système en lecture seule). Utilisez une URL d’image (CDN, Imgur, lien direct, etc.).",
      });
    }
    next();
  },
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier reçu." });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  }
);

module.exports = app;

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
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
      process.exit(1);
    });
}
