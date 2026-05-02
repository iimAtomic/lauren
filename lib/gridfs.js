const mongoose = require("mongoose");

const BUCKET_NAME = "uploads";

function getBucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB non connecté");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

function publicUrlPath(objectIdHex) {
  return `/api/media/${objectIdHex}`;
}

/**
 * @returns {Promise<string>} ObjectId hex
 */
async function saveImageBuffer(buffer, originalFilename, contentType) {
  const b = getBucket();
  const safeName =
    typeof originalFilename === "string" && originalFilename.length > 0
      ? originalFilename.replace(/[^\w.\-]/g, "_").slice(0, 180)
      : "image";
  const uploadStream = b.openUploadStream(safeName, {
    contentType: contentType || "image/jpeg",
  });
  return new Promise((resolve, reject) => {
    uploadStream.once("finish", () => resolve(String(uploadStream.id)));
    uploadStream.once("error", reject);
    uploadStream.end(buffer);
  });
}

async function streamImageById(idHex, res) {
  if (!mongoose.Types.ObjectId.isValid(idHex)) {
    res.status(400).end();
    return;
  }
  const b = getBucket();
  const id = new mongoose.Types.ObjectId(idHex);
  const files = await b.find({ _id: id }).toArray();
  if (!files.length) {
    res.status(404).end();
    return;
  }
  const meta = files[0];
  res.setHeader("Content-Type", meta.contentType || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  const stream = b.openDownloadStream(id);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end();
  });
  stream.pipe(res);
}

module.exports = {
  saveImageBuffer,
  streamImageById,
  publicUrlPath,
};
