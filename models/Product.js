const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    image_url: { type: String, default: "" },
    description: { type: String, default: "" },
    category: { type: String, default: "", trim: true },
    sub_category: { type: String, default: "", trim: true },
    price: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
