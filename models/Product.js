const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    image_url: { type: String, default: "", maxlength: 2048 },
    description: { type: String, default: "", maxlength: 12000 },
    category: { type: String, default: "", trim: true, maxlength: 160 },
    sub_category: { type: String, default: "", trim: true, maxlength: 160 },
    price: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
