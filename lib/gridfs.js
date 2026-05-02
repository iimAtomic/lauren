const mongoose = require("mongoose");

const BUCKET_NAME = "uploads";

let bucketCache = null;
let cachedConnId = null;

function getBucket() {
  const conn = mongoose.connection;
  if (!conn || !conn.db || conn.readyState !== 1) {
    throw new Error("MongoDB non connecté");
  }
  if (!bucketCache || cachedConnId !== conn.id) {
    bucketCache = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: BUCKET_NAME });
    cachedConnId = conn.id;
  }
  return bucketCache;
}

function publicUrlPath(objectIdHex) {
  return `/api/media/${objectIdHex}`;
}

/**
 * @returns {Promise<string>} ObjectId hex du fichier enregistré dans GridFS
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
    if (!res.headersSent) res.status(400).end();
    return;
  }
  const b = getBucket();
  const id = new mongoose.Types.ObjectId(idHex);
  const files = await b.find({ _id: id }).limit(1).toArray();
  if (!files.length) {
    if (!res.headersSent) res.status(404).end();
    return;
  }
  const meta = files[0];
  res.setHeader("Content-Type", meta.contentType || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (meta.length != null) res.setHeader("Content-Length", String(meta.length));
  const stream = b.openDownloadStream(id);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end();
    else res.end();
  });
  stream.pipe(res);
}

module.exports = {
  saveImageBuffer,
  streamImageById,
  publicUrlPath,
};
