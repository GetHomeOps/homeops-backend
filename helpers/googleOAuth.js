"use strict";

/**
 * Google OAuth Helper
 *
 * Handles Authorization Code Flow: build auth URL, exchange code for tokens,
 * verify ID token. Uses google-auth-library.
 *
 * Exports: buildAuthUrl, exchangeCodeForTokens, verifyIdToken
 */

const { OAuth2Client } = require("google-auth-library");
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} = require("../config");

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["openid", "email", "profile"];

/**
 * Build Google OAuth authorization URL.
 * @param {Object} opts
 * @param {string} opts.redirectUri - Callback URL (signin or signup)
 * @param {string} opts.state - CSRF state value
 * @returns {string} Full authorization URL
 */
function buildAuthUrl({ redirectUri, state }) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google OAuth is not configured");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state: state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 * @param {string} code - Authorization code from Google
 * @param {string} redirectUri - Must match the redirect_uri used in auth request
 * @returns {Promise<{id_token: string, access_token: string, refresh_token?: string}>}
 */
async function exchangeCodeForTokens(code, redirectUri) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured");
  }
  const client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri
  );
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token");
  }
  return tokens;
}

/**
 * Verify Google ID token and extract claims.
 * Validates aud, iss, exp.
 * @param {string} idToken - JWT id_token from Google
 * @returns {Promise<{sub: string, email: string, email_verified: boolean, name?: string, picture?: string}>}
 */
async function verifyIdToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google OAuth is not configured");
  }
  const client = new OAuth2Client(GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error("Invalid ID token: missing sub");
  }
  return {
    sub: payload.sub,
    email: payload.email || "",
    email_verified: !!payload.email_verified,
    name: payload.name || payload.email || "User",
    picture: payload.picture || null,
  };
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  verifyIdToken,
};
