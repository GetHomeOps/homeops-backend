/**
 * Express Application
 *
 * Configures the main Express app: CORS, compression, JSON parsing,
 * JWT authentication, and route mounting. All API routes are mounted
 * under their respective paths. 404 and error handlers at the end.
 *
 * Route prefixes:
 * - /auth, /users, /accounts, /contacts, /properties
 * - /systems, /maintenance, /documents, /propertyDocuments
 * - /subscriptions, /subscription-products, /invitations
 * - /engagement, /analytics, /predict
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { NotFoundError } = require("./expressError");
const { authenticateJWT, ensureLoggedIn } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const mfaRoutes = require("./routes/mfa");
const usersRoutes = require("./routes/users");
const accountsRoutes = require("./routes/accounts");
const contactsRoutes = require("./routes/contacts");
const propertiesRoutes = require("./routes/properties");
const systemsRoutes = require("./routes/systems");
const maintenanceRecordsRoutes = require("./routes/maintenanceRecords");
const documentsRoutes = require("./routes/documents");
const propertyDocumentsRoutes = require("./routes/propertyDocuments");
const subscriptionsRoutes = require("./routes/subscriptions");
const subscriptionProductsRoutes = require("./routes/subscriptionProducts");
const invitationsRoutes = require("./routes/invitations");
const platformEngagementRoutes = require("./routes/platformEngagement");
const platformAnalyticsRoutes = require("./routes/platformAnalytics");
const propertyPredictRoutes = require("./routes/propertyPredict");
const professionalCategoriesRoutes = require("./routes/professionalCategories");
const professionalsRoutes = require("./routes/professionals");
const maintenanceEventsRoutes = require("./routes/maintenanceEvents");
const savedProfessionalsRoutes = require("./routes/savedProfessionals");
const supportTicketsRoutes = require("./routes/supportTickets");
const resourcesRoutes = require("./routes/resources");
const notificationsRoutes = require("./routes/notifications");

const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://homeops-frontend2-production.up.railway.app'
    ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

app.use(compression());
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'HomeOps Backend API',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.use(authenticateJWT);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later.", status: 429 } },
});

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many MFA attempts, please try again later.", status: 429 } },
});

app.use("/auth", authLimiter, authRoutes);
app.use("/mfa", mfaLimiter, ensureLoggedIn, mfaRoutes);
app.use("/users", usersRoutes);
app.use("/accounts", accountsRoutes);
app.use("/contacts", contactsRoutes);
app.use("/properties", propertiesRoutes);
app.use("/systems", systemsRoutes);
app.use("/maintenance", maintenanceRecordsRoutes);
app.use("/documents", documentsRoutes);
app.use("/propertyDocuments", propertyDocumentsRoutes);
app.use("/subscriptions", subscriptionsRoutes);
app.use("/subscription-products", subscriptionProductsRoutes);
app.use("/invitations", invitationsRoutes);
app.use("/engagement", platformEngagementRoutes);
app.use("/analytics", platformAnalyticsRoutes);
app.use("/predict", propertyPredictRoutes);
app.use("/professional-categories", professionalCategoriesRoutes);
app.use("/professionals", professionalsRoutes);
app.use("/maintenance-events", maintenanceEventsRoutes);
app.use("/saved-professionals", savedProfessionalsRoutes);
app.use("/support-tickets", supportTicketsRoutes);
app.use("/resources", resourcesRoutes);
app.use("/notifications", notificationsRoutes);

app.use(function (req, res, next) {
  throw new NotFoundError();
});

app.use(function (err, req, res, next) {
  if (process.env.NODE_ENV !== "test") console.error(err.stack);

  const status = err.status || 500;
  const message = err.message;

  return res.status(status).json({
    error: { message, status },
  });
});

module.exports = app;
