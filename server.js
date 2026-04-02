const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const Product = require("./models/Product");

const app = express();
const PORT = process.env.PORT;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;
/** Numéro international sans + ni espaces (ex. 2250712345678 pour la Côte d’Ivoire) */
const WHATSAPP_ORDER_NUMBER = process.env.WHATSAPP_ORDER_NUMBER
  ? String(process.env.WHATSAPP_ORDER_NUMBER).replace(/\D/g, "")
  : "";

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error("Fichier image uniquement"), ok);
  },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

/** Numéro WhatsApp pour les commandes (exposé au front pour wa.me) */
app.get("/api/order-contact", (_req, res) => {
  res.json({ whatsapp: WHATSAPP_ORDER_NUMBER });
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

app.post("/api/upload", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Aucun fichier reçu." });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

async function main() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const safeUri = MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
  console.log("MongoDB connecté :", safeUri);
  app.listen(PORT, () => {
    console.log(`Maison Mona — http://localhost:${PORT}`);
    console.log(`Admin — http://localhost:${PORT}/admin.html`);
  });
}

main().catch((err) => {
  console.error("\n❌ Connexion MongoDB impossible.\n");
  if (String(MONGODB_URI).includes("127.0.0.1") || String(MONGODB_URI).includes("localhost")) {
    console.error(
      "→ MongoDB local n’est pas démarré, ou MONGODB_URI n’est pas chargé depuis .env.\n" +
        "   Vérifiez que le fichier .env est à la racine du projet et contient MONGODB_URI=...\n"
    );
  } else {
    console.error(
      "→ Vérifiez l’URI Atlas (nom de base après le domaine : /maison_mona), le mot de passe,\n" +
        "   et dans Atlas : Network Access → IP autorisées (ex. 0.0.0.0/0 pour les tests).\n"
    );
  }
  console.error(err.message || err);
  process.exit(1);
});
