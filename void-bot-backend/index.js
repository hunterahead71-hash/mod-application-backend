const express = require("express");
const session = require("express-session");
const cors = require("cors");
const MemoryStore = require('memorystore')(session);
const path = require('path');

// Import configurations
const { supabase } = require("./config/supabase");
const { initializeBot, bot, botReady } = require("./config/discord");

// Import middleware
const { logger } = require("./utils/logger");

// Import routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const submissionRoutes = require("./routes/submissions");
const debugRoutes = require("./routes/debug");
const healthRoutes = require("./routes/health");

const app = express();

/* ================= CORS & SESSION CONFIG ================= */

app.use(
  cors({
    origin: function(origin, callback) {
      const allowedOrigins = [
        "https://hunterahead71-hash.github.io",
        "http://localhost:3000",
        "http://localhost:5500",
        "http://localhost:8000",
        "https://mod-application-backend.onrender.com"
      ];
      
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        logger.warn(`Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
  })
);

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// Session configuration
app.use(
  session({
    store: new MemoryStore({
      checkPeriod: 86400000
    }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "4d7a9b2f5c8e1a3b6d9f0c2e5a8b1d4f7c0e3a6b9d2f5c8e1a4b7d0c3f6a9b2e5c8f1b4d7e0a3c6b9d2f5e8c1b4a7d0c3f6b9e2c5a8d1b4e7c0a3d6b9e2c5f8",
    resave: true,
    saveUninitialized: true,
    proxy: true,
    cookie: {
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
    }
  })
);

// Debug middleware
app.use((req, res, next) => {
  logger.request(req.method, req.path);
  next();
});

/* ================= INITIALIZE BOT ================= */

initializeBot();

/* ================= ROUTES ================= */

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/", submissionRoutes);
app.use("/debug", debugRoutes);
app.use("/", healthRoutes);

// Static routes for testing
app.get("/bot-invite", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  
  if (!clientId || clientId === "your_client_id_here") {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Bot Setup Required</title></head>
      <body>
        <h1>❌ DISCORD_CLIENT_ID not set!</h1>
        <p>Steps to fix:</p>
        <ol>
          <li>Go to <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a></li>
          <li>Click your application → OAuth2 → Copy "Client ID"</li>
          <li>Add to Render.com as DISCORD_CLIENT_ID environment variable</li>
          <li>Redeploy</li>
        </ol>
      </body>
      </html>
    `);
  }
  
  const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268435456&scope=bot%20applications.commands`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bot Invite Link</title>
      <style>
        body { font-family: Arial; padding: 40px; text-align: center; background: #0f0f23; color: white; }
        .success { color: #00ffea; font-size: 24px; margin: 20px 0; }
        .link { background: #2f3136; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 600px; word-break: break-all; }
        a { color: #00ffea; text-decoration: none; }
        a:hover { text-decoration: underline; }
        button { padding: 15px 30px; background: #5865f2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 18px; }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(88, 101, 242, 0.4); }
      </style>
    </head>
    <body>
      <h1>🤖 Bot Invite Link</h1>
      <div class="success">✅ Use this link to invite the bot to your server:</div>
      <div class="link">
        <a href="${inviteLink}" target="_blank">${inviteLink}</a>
      </div>
      <p><a href="${inviteLink}" target="_blank"><button>Click here to invite bot</button></a></p>
      <p>Client ID: ${clientId}</p>
    </body>
    </html>
  `);
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error("Logout error:", err);
    }
    res.redirect("https://hunterahead71-hash.github.io/void.training/");
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.startup(PORT, botReady);
});
