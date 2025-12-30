const express = require('express');
const cors = require('cors');
const { NotFoundError } = require("./expressError");
const { authenticateJWT } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const databasesRoutes = require("./routes/databases");
const contactsRoutes = require("./routes/contacts");

const app = express();

// CORS MUST be configured before any other middleware to handle preflight requests
const corsOptions = {
  origin: [
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

app.use(express.json());

app.use(authenticateJWT);

// Add this health check route;
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

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/databases", databasesRoutes);
app.use("/contacts", contactsRoutes);

/** Handle 404 errors -- this matches everything */
app.use(function (req, res, next) {
  throw new NotFoundError();
});

/** Generic error handler; anything unhandled goes here. */
app.use(function (err, req, res, next) {
  if (process.env.NODE_ENV !== "test") console.error(err.stack);

  const status = err.status || 500;
  const message = err.message;

  return res.status(status).json({
    error: { message, status },
  });
});

module.exports = app;