// server.js
require('dotenv').config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const MemoryStore = require('memorystore')(session);

const app = express();

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Import bot (starts automatically)
require('./bot');

// Middleware
app.use(cors({
  origin: [
    "https://hunterahead71-hash.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:8000",
    "https://mod-application-backend.onrender.com"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

// Session
app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET || "super-secret-key-change-me",
  resave: true,
  saveUninitialized: true,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Debug middleware (optional - remove in production)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Session: ${!!req.session.user}`);
  next();
});

// Routes
app.use('/admin', require('./admin'));

// Health check
app.get("/health", async (req, res) => {
  try {
    const { data, error } = await supabase.from("applications").select("count", { count: 'exact', head: true });
    res.json({
      status: "ok",
      database: error ? "error" : "connected",
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
