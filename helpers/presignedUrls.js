"use strict";

const { getPresignedUrl } = require("../services/s3Service");

/**
 * Check if an S3 key is safe to use (basic path traversal prevention).
 * @param {string} key
 * @returns {boolean}
 */
function isSafeS3Key(key) {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (trimmed.includes("..") || trimmed.includes("//") || trimmed.startsWith("/")) return false;
  return true;
}

/**
 * Add a presigned URL to a single item for a given key field.
 * Uses the same presigned logic as documents/presigned-preview (~5 min expiry).
 *
 * @param {Object} item - Object that may have a key field (e.g. { image: "uploads/contacts/abc.jpg" })
 * @param {string} keyField - Field name containing the S3 key
 * @param {string} [urlField] - Output field name (default: `${keyField}_url`)
 * @returns {Promise<Object>} Copy of item with urlField added (null if key missing/invalid)
 */
async function addPresignedUrlToItem(item, keyField, urlField = null) {
  const urlFieldName = urlField || `${keyField}_url`;
  const key = item[keyField];

  if (!isSafeS3Key(key)) {
    return { ...item, [urlFieldName]: null };
  }

  try {
    const url = await getPresignedUrl(key.trim());
    return { ...item, [urlFieldName]: url };
  } catch (err) {
    return { ...item, [urlFieldName]: null };
  }
}

/**
 * Add presigned URLs to multiple items for a given key field.
 *
 * @param {Array<Object>} items - Array of objects
 * @param {string} keyField - Field name containing the S3 key
 * @param {string} [urlField] - Output field name (default: `${keyField}_url`)
 * @returns {Promise<Array<Object>>}
 */
async function addPresignedUrlsToItems(items, keyField, urlField = null) {
  if (!Array.isArray(items) || items.length === 0) return items;
  return Promise.all(items.map((item) => addPresignedUrlToItem({ ...item }, keyField, urlField)));
}

module.exports = {
  addPresignedUrlToItem,
  addPresignedUrlsToItems,
  isSafeS3Key,
};
