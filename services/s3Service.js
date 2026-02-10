"use strict";

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { AWS_REGION, AWS_S3_BUCKET, AWS_S3_ENDPOINT } = require("../config");

function createS3Client(region = AWS_REGION, endpoint = AWS_S3_ENDPOINT) {
  const config = { region };
  if (endpoint) config.endpoint = endpoint;
  return new S3Client(config);
}

const s3Client = createS3Client();

/** Presigned URL expiration in seconds (5 minutes). */
const PRESIGNED_EXPIRATION = 5 * 60;

/**
 * Upload a file buffer to S3.
 * @param {Buffer} fileBuffer - The file content
 * @param {string} key - S3 object key (path/filename)
 * @param {string} contentType - MIME type (e.g., application/pdf, image/jpeg)
 * @returns {Promise<{ key: string, url: string }>}
 */
function getRedirectEndpointFromError(err) {
  // Check if error has Endpoint directly (SDK may deserialize XML onto error)
  const directHost = err.Endpoint || err.endpoint;
  if (directHost && typeof directHost === "string") {
    const host = directHost.trim();
    const regionMatch = host.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i);
    if (regionMatch) return `https://s3.${regionMatch[1]}.amazonaws.com`;
    if (host.includes("amazonaws.com")) return `https://${host.replace(/^[^.]+\./, "s3.")}`;
  }
  // Parse from XML in response body
  const rawBody = err.$response?.body;
  const body = typeof rawBody === "string" ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString() : rawBody?.toString?.() ?? null);
  if (!body || typeof body !== "string") return null;
  const match = body.match(/<Endpoint>([^<]+)<\/Endpoint>/);
  if (!match) return null;
  const host = match[1].trim();
  const regionMatch = host.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i);
  if (regionMatch) return `https://s3.${regionMatch[1]}.amazonaws.com`;
  if (host.includes("amazonaws.com")) return `https://${host.replace(/^[^.]+\./, "s3.")}`;
  return null;
}

async function uploadFile(fileBuffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  let client = s3Client;
  let lastError;

  let usedRegion = AWS_REGION;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.send(command);
      const url = `https://${AWS_S3_BUCKET}.s3.${usedRegion}.amazonaws.com/${key}`;
      return { key, url };
    } catch (err) {
      lastError = err;
      if (err.name === "PermanentRedirect" && attempt === 0) {
        const endpoint = getRedirectEndpointFromError(err);
        if (endpoint) {
          const regionMatch = endpoint.match(/s3\.([a-z0-9-]+)\.amazonaws/i);
          usedRegion = regionMatch ? regionMatch[1] : AWS_REGION;
          client = createS3Client(usedRegion, endpoint);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Delete a file from S3 by key.
 */
async function deleteFile(key) {
  const command = new DeleteObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
  });
  let client = s3Client;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.send(command);
      return;
    } catch (err) {
      if (err.name === "PermanentRedirect" && attempt === 0) {
        const endpoint = getRedirectEndpointFromError(err);
        if (endpoint) {
          const regionMatch = endpoint.match(/s3\.([a-z0-9-]+)\.amazonaws/i);
          const region = regionMatch ? regionMatch[1] : AWS_REGION;
          client = createS3Client(region, endpoint);
          continue;
        }
      }
      throw err;
    }
  }
}

/**
 * Generate a presigned GET URL for secure document preview.
 * @param {string} key - S3 object key (path/filename)
 * @param {number} [expiresIn=300] - URL expiration in seconds (default 5 min)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedUrl(key, expiresIn = PRESIGNED_EXPIRATION) {
  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = { uploadFile, deleteFile, getPresignedUrl };