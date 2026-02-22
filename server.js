/**
 * Server Entry Point
 *
 * Starts the Express app. Initializes i18next for translations, mounts the app,
 * and runs startup tasks: ensure super admin exists, create default account if
 * needed, seed subscription products. Listens on PORT (default 3000).
 */
const express = require('express');
const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const Backend = require('i18next-fs-backend');

const path = require('path');
require('dotenv').config();

const User = require('./models/user');
const Account = require('./models/account');
const SubscriptionProduct = require('./models/subscriptionProduct');
const fs = require('fs');

const app = require('./app.js');

i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json'
    },
    fallbackLng: 'en',
    preload: ['en', 'es'],
    ns: ['dynamic'],
    defaultNS: 'dynamic',
  });

app.use(i18nextMiddleware.handle(i18next));

app.get('/locales/:lng/:ns', (req, res) => {
  const { lng, ns } = req.params;
  const filePath = path.join(__dirname, 'locales', lng, `${ns}.json`);

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

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const user = await User.initializeSuperAdmin();
    console.log("Super Admin user:", user);

    if (user) {
      const accounts = await Account.getUserAccounts(user.id).catch(() => []);

      if (!accounts || accounts.length === 0) {
        const account = await Account.linkNewUserToAccount({
          name: 'main',
          userId: user.id,
        });
        console.log("Main account created:", account);
      } else {
        console.log("Super Admin already has an account.");
      }
    }

    await SubscriptionProduct.initializeDefaultProducts();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
