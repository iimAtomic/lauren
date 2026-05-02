const IS_PROD = process.env.NODE_ENV === "production";

/** Limites strings pour payloads raisonnables */
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

/** Connexion admin : comparaison simple (trim) pour éviter les blocages en prod. */
function adminPasswordMatch(provided, secret) {
  if (!secret || typeof secret !== "string") return false;
  return String(provided ?? "").trim() === String(secret).trim();
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

module.exports = {
  IS_PROD,
  LIMITS,
  adminPasswordMatch,
  sanitizeProductFields,
  sanitizeProductPatch,
  validationErrorForProduct,
  sendServerError,
};
