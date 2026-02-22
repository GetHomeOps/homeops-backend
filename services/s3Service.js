"use strict";

/**
 * S3 Service
 *
 * AWS S3 operations for file storage. Uploads files, deletes by key,
 * and generates presigned GET URLs for secure document preview.
 *
 * Exports: uploadFile, deleteFile, getPresignedUrl
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { AWS_REGION, AWS_S3_BUCKET } = require("../config");

const s3Client = new S3Client({
  region: AWS_REGION,
  followRegionRedirects: true, // Follow 301 redirects when bucket is in a different region
});

/** Presigned URL expiration in seconds (5 minutes). */
const PRESIGNED_EXPIRATION = 5 * 60;

/**
 * Upload a file buffer to S3.
 * @param {Buffer} fileBuffer - The file content
 * @param {string} key - S3 object key (path/filename)
 * @param {string} contentType - MIME type (e.g., application/pdf, image/jpeg)
 * @returns {Promise<{ key: string, url: string }>}
 */
async function uploadFile(fileBuffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  const url = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
  return { key, url };
}

/**
 * Delete a file from S3 by key.
 */
async function deleteFile(key) {
  const command = new DeleteObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
  });
  await s3Client.send(command);
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