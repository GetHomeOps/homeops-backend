const express = require('express');
const { NotFoundError } = require("./expressError");
const { authenticateJWT } = require("./middleware/auth");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const databasesRoutes = require("./routes/databases");
const contactsRoutes = require("./routes/contacts");

const app = express();

app.use(express.json());

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(authenticateJWT);

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