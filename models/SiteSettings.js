const mongoose = require("mongoose");

const siteSettingsSchema = new mongoose.Schema(
  {
    /** Jusqu’à 4 URLs ; chaîne vide = image par défaut côté boutique */
    heroImages: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
