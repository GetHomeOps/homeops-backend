/**
 * server.js
 *
 * Main server file for setting up Express with i18next for internationalization.
 * Serves dynamic translations and enables CORS for cross-origin requests.
 */
const express = require('express');
const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const Backend = require('i18next-fs-backend');

const path = require('path');
require('dotenv').config();

const User = require('./models/user');
const Database = require('./models/database');
const fs = require('fs');

const app = require('./app.js');

i18next
  .use(Backend) // Load translations using filesystem backend
  .use(i18nextMiddleware.LanguageDetector) // Detects language from request
  .init({
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json' // Path to translation files
    },
    fallbackLng: 'en', // Fallback language if the requested one is not available
    preload: ['en', 'es'], // Preload specific languages
    ns: ['dynamic'], // Namespace for dynamic translations
    defaultNS: 'dynamic', // Default namespace
  });

// Middleware for handling internationalization
app.use(i18nextMiddleware.handle(i18next));

// Endpoint to serve dynamic translations
/**
 * GET /locales/:lng/:ns
 *
 * Serves the translation file for the specified language and namespace.
 * Example: /locales/en/dynamic
 */
app.get('/locales/:lng/:ns', (req, res) => {
  const { lng, ns } = req.params;
  const filePath = path.join(__dirname, 'locales', lng, `${ns}.json`);

  // Check if file exists before sending response
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error loading translation file: ${filePath}`, err);
      return res.status(404).json({ error: 'Translation file not found' });
    }
    try {
      const jsonData = JSON.parse(data);
      res.json(jsonData);
    } catch (parseError) {
      console.error(`Error parsing JSON file: ${filePath}`, parseError);
      res.status(500).json({ error: 'Invalid JSON format' });
    }
  });
});

// Server Port
const PORT = process.env.PORT || 3000;

// Initialize database in background (non-blocking)
async function initializeDatabase() {
  try {
    const user = await User.initializeSuperAdmin();
    console.log("Super Admin user:", user);

    if (user) {
      const mainDb = await Database.createMainDatabase(user.id);
      console.log("mainDb (after creation):", mainDb);

      if (mainDb) {
        const userDb = await Database.addUserToDatabase({ userId: user.id, databaseId: mainDb.id });
        console.log("userDb (after adding user):", userDb);

        if (userDb) {
          console.log("User added to main database successfully.");
        }
      } else {
        console.warn("Main database creation failed, but server is running.");
      }
    }
  } catch (error) {
    // Log database errors but don't crash the server
    console.error('Database initialization error (server still running):', error);
  }
}

// Start server immediately
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  // Initialize database in parallel after server starts
  initializeDatabase();
});
