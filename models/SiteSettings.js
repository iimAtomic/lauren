const mongoose = require("mongoose");

const shopCategorySchema = new mongoose.Schema(
  {
    slug: { type: String, trim: true, required: true },
    label: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    /** Jusqu’à 4 URLs ; chaîne vide = image par défaut côté boutique */
    heroImages: { type: [String], default: [] },
    /** Filtres affichés sous « Boutique » ; slug utilisé pour filtrer produits (texte catégorie / sous-catégorie) */
    shopCategories: { type: [shopCategorySchema], default: undefined },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
