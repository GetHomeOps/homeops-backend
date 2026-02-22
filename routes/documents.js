"use strict";

const express = require("express");
const multer = require("multer");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const { uploadFile, getPresignedUrl } = require("../services/s3Service");
const { AWS_S3_BUCKET } = require("../config");
const { ulid } = require("ulid");

const router = express.Router();

/**
 * Validates S3 key to prevent path traversal and invalid input.
 */
function validateFileKey(key) {
  if (!key || typeof key !== "string") {
    throw new BadRequestError("Missing or invalid file key");
  }
  const trimmed = key.trim();
  if (!trimmed) throw new BadRequestError("File key cannot be empty");
  if (trimmed.includes("..") || trimmed.includes("//") || trimmed.startsWith("/")) {
    throw new BadRequestError("Invalid file key");
  }
  if (!trimmed.startsWith("documents/")) throw new BadRequestError("Invalid file key");
  if (trimmed.length > 512) throw new BadRequestError("File key too long");
  return trimmed;
}

// Configure multer for memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Optional: restrict file types
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError("Invalid file type"), false);
    }
  },
});

/** POST /upload - Upload file to S3. Multipart form-data with "file" field. Returns key and URL. 10MB limit. */
router.post("/upload", ensureLoggedIn, upload.single("file"), async (req, res, next) => {
  try {
    if (!AWS_S3_BUCKET) {
      throw new BadRequestError(
        "File upload is not configured. Set AWS_S3_BUCKET (and AWS credentials) in the server environment."
      );
    }
    if (!req.file) {
      throw new BadRequestError("No file provided");
    }

    const userId = res.locals.user?.id;
    const ext = req.file.originalname.split(".").pop() || "bin";
    const key = `documents/${userId}/${Date.now()}-${ulid().slice(-8)}.${ext}`;

    const { key: s3Key, url } = await uploadFile(
      req.file.buffer,
      key,
      req.file.mimetype
    );

    return res.status(201).json({
      document: { key: s3Key, url },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      if (err.name === "AccessDenied" || err.Code === "AccessDenied") {
        console.error(
          "[documents/upload] S3 Access Denied. Ensure the server's AWS identity (env or IAM role) has s3:PutObject on bucket:",
          AWS_S3_BUCKET,
          "Region:",
          process.env.AWS_REGION || "us-east-2"
        );
      }
      console.error("[documents/upload]", err.message || err);
    }
    return next(err);
  }
});

/** GET /presigned-preview?key= - Temporary presigned URL for document preview. Expires in 5 min. */
router.get("/presigned-preview", ensureLoggedIn, async (req, res, next) => {
  try {
    const validKey = validateFileKey(req.query.key);
    const url = await getPresignedUrl(validKey);
    return res.json({ url });
  } catch (err) {
    if (err.name === "NoSuchKey") {
      return next(new BadRequestError("File not found"));
    }
    return next(err);
  }
});

module.exports = router;