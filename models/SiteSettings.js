const mongoose = require("mongoose");

const shopCategorySchema = new mongoose.Schema(
  {
    slug: { type: String, trim: true, required: true, maxlength: 160 },
    label: { type: String, trim: true, required: true, maxlength: 160 },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    /** Jusqu’à 4 URLs ; chaîne vide = image par défaut côté boutique. */
    heroImages: { type: [{ type: String, maxlength: 2048 }], default: [] },
    /** Filtres affichés sous « Boutique » ; slug = mot-clé pour filtrer (catégorie / sous-catégorie). */
    shopCategories: { type: [shopCategorySchema], default: undefined },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
