const express = require("express");
const session = require("express-session");
const MemoryStore = require('memorystore')(session);
const path = require('path');

// Config
const { supabase } = require("./config/supabase");
const { initialize: initBot, getClient, botReady } = require("./config/discord");

// Logger
const { logger } = require("./utils/logger");

// Routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const submissionRoutes = require("./routes/submissions");
const debugRoutes = require("./routes/debug");
const healthRoutes = require("./routes/health");

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CORS ====================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ==================== SESSION ====================
app.use(
  session({
    store: new MemoryStore({ checkPeriod: 86400000 }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "super-secret-key-change-me",
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

// Request logger
app.use((req, res, next) => {
  logger.request(req.method, req.path);
  next();
});

// ==================== INIT BOT ====================
initBot();

// ==================== TEST ENDPOINTS ====================
app.get("/ping", (req, res) => {
  res.json({ success: true, message: "pong", time: new Date().toISOString() });
});

app.get("/set-test-intent", (req, res) => {
  if (req.session) {
    req.session.loginIntent = "test";
  }
  res.json({ success: true, message: "Intent set" });
});

app.get("/set-admin-intent", (req, res) => {
  if (req.session) {
    req.session.loginIntent = "admin";
  }
  res.json({ success: true, message: "Intent set" });
});

// ==================== STATIC PAGES ====================
app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get("/bot-invite", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return res.send("DISCORD_CLIENT_ID not set");
  }
  const link = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268435456&scope=bot%20applications.commands`;
  res.send(`<a href="${link}">Invite Bot</a>`);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("https://hunterahead71-hash.github.io/void.training/");
  });
});

// ==================== ROUTES ====================
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/", submissionRoutes);
app.use("/debug", debugRoutes);
app.use("/", healthRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           VOID ESPORTS MOD TEST SERVER v3.0 (FIXED)           ║
╠════════════════════════════════════════════════════════════════╣
║ 🚀 Port: ${PORT}                                                ║
║ 🤖 Bot: ${getClient() ? '✅ Ready' : '🔄 Starting...'}                      ║
║ 📊 DB: ${process.env.SUPABASE_URL ? '✅' : '❌'}                              ║
║ 🏰 Guild: ${process.env.DISCORD_GUILD_ID ? '✅' : '❌'}                        ║
║ 🛡️ Roles: ${process.env.MOD_ROLE_ID ? '✅' : '❌'}                            ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
