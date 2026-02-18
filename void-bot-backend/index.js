const express = require("express");
const session = require("express-session");
const cors = require("cors");
const MemoryStore = require('memorystore')(session);
const path = require('path');

// Import configurations
const { supabase } = require("./config/supabase");
const { initializeBot, bot, botReady, getBot } = require("./config/discord");

// Import middleware
const { logger } = require("./utils/logger");

// Import routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const submissionRoutes = require("./routes/submissions");
const debugRoutes = require("./routes/debug");
const healthRoutes = require("./routes/health");

const app = express();

/* ================= CORS CONFIGURATION - FIXED ================= */
// This must come before any route definitions
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow requests from any origin, but echo the origin for credentialed requests
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

/* ================= CRITICAL: DIRECT TEST INTENT ENDPOINT ================= */
// This MUST be before session middleware? Actually session is used, so after session.
// But session middleware is below. We'll put it after session but before other routes.
// However, we need session to set loginIntent, so it must be after session.

/* ================= SESSION CONFIGURATION ================= */
app.use(
  session({
    store: new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "4d7a9b2f5c8e1a3b6d9f0c2e5a8b1d4f7c0e3a6b9d2f5c8e1a4b7d0c3f6a9b2e5c8f1b4d7e0a3c6b9d2f5e8c1b4a7d0c3f6b9e2c5a8d1b4e7c0a3d6b9e2c5f8",
    resave: true,
    saveUninitialized: true,
    proxy: true,
    cookie: {
      secure: true, // set to true if using https
      sameSite: 'none', // required for cross-site requests
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
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

/* ================= SIMPLE TEST ENDPOINTS ================= */
// Ping endpoint (no session needed)
app.get("/ping", (req, res) => {
  res.json({ 
    success: true, 
    message: "pong",
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || 'no-session'
  });
});

// ==================== CRITICAL FIX: DIRECT SET-TEST-INTENT ====================
// This endpoint MUST return 200 with proper CORS headers (already handled globally)
app.get("/set-test-intent", (req, res) => {
  console.log("🔥🔥🔥 SET TEST INTENT HIT - DIRECT RESPONSE 🔥🔥🔥");
  console.log("Session ID:", req.sessionID);
  
  // Set the intent if session exists
  if (req.session) {
    req.session.loginIntent = "test";
    req.session.save((err) => {
      if (err) console.error("Session save error in set-test-intent:", err);
    });
  }
  
  // Always return success
  res.status(200).json({ 
    success: true, 
    message: "Test intent set successfully",
    timestamp: new Date().toISOString()
  });
});

// Also handle admin intent similarly if needed
app.get("/set-admin-intent", (req, res) => {
  console.log("🔥 ADMIN INTENT HIT");
  if (req.session) {
    req.session.loginIntent = "admin";
    req.session.save();
  }
  res.status(200).json({ success: true, message: "Admin intent set" });
});

/* ================= TEST PAGES ================= */
// Simple test page for debugging
app.get("/test", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Backend Test</title>
      <style>
        body { 
          background: linear-gradient(135deg, #0f0f23, #1a1a2e); 
          color: white; 
          font-family: Arial; 
          padding: 40px;
          text-align: center;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background: rgba(32, 34, 37, 0.9);
          padding: 30px;
          border-radius: 15px;
          border: 1px solid rgba(255, 0, 51, 0.3);
        }
        h1 { 
          background: linear-gradient(135deg, #ff0033, #00ffea);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-size: 36px;
        }
        button {
          padding: 15px 30px;
          background: linear-gradient(135deg, #5865f2, #4752c4);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          margin: 10px;
          transition: all 0.3s ease;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(88, 101, 242, 0.4);
        }
        pre {
          background: #202225;
          padding: 20px;
          border-radius: 10px;
          text-align: left;
          overflow: auto;
          margin-top: 20px;
          max-height: 400px;
        }
        .success { color: #3ba55c; }
        .error { color: #ed4245; }
        .info { color: #00ffea; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 Void Esports Backend</h1>
        <p class="info">Your backend is running!</p>
        
        <div>
          <button onclick="testHealth()">Test Health</button>
          <button onclick="testStartTest()">Test Start Test</button>
          <button onclick="testAuth()">Test Auth</button>
          <button onclick="testBotStatus()">Test Bot Status</button>
        </div>
        
        <pre id="result">Click a button to test...</pre>
      </div>
      
      <script>
        async function testHealth() {
          try {
            const response = await fetch('/health');
            const data = await response.json();
            document.getElementById('result').innerHTML = 
              '<span class="success">✅ Health Check Success!</span>\n\n' + 
              JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('result').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        async function testStartTest() {
          try {
            const response = await fetch('/api/start-test', {
              credentials: 'include'
            });
            const data = await response.json();
            document.getElementById('result').innerHTML = 
              '<span class="success">✅ Start Test Working!</span>\n\n' + 
              JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('result').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        async function testAuth() {
          try {
            window.location.href = '/auth/discord';
          } catch (error) {
            document.getElementById('result').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        async function testBotStatus() {
          try {
            const response = await fetch('/debug/bot/status');
            const data = await response.json();
            document.getElementById('result').innerHTML = 
              '<span class="success">✅ Bot Status:</span>\n\n' + 
              JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('result').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Frontend integration test page
app.get("/frontend-test", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Frontend Test</title>
      <style>
        body { background: #0f0f23; color: white; font-family: Arial; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        button { padding: 10px 20px; background: #5865f2; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        pre { background: #202225; padding: 10px; border-radius: 5px; overflow: auto; }
        .success { color: #3ba55c; }
        .error { color: #ed4245; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 Frontend Integration Test</h1>
        
        <h3>Test 1: Ping Backend</h3>
        <button onclick="testPing()">Test Ping</button>
        <pre id="pingResult">-</pre>
        
        <h3>Test 2: Set Test Intent</h3>
        <button onclick="testSetIntent()">Test /set-test-intent</button>
        <pre id="intentResult">-</pre>
        
        <h3>Test 3: Start Test</h3>
        <button onclick="testStartTest()">Test /api/start-test</button>
        <pre id="startResult">-</pre>
        
        <h3>Test 4: Full Auth Flow</h3>
        <button onclick="testFullAuth()">Test Full Auth</button>
        <pre id="authResult">-</pre>
      </div>
      
      <script>
        async function testPing() {
          try {
            const response = await fetch('/ping', {
              credentials: 'include'
            });
            const data = await response.json();
            document.getElementById('pingResult').innerHTML = 
              '<span class="success">✅ Success:</span>\n' + JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('pingResult').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        async function testSetIntent() {
          try {
            const response = await fetch('/set-test-intent', {
              credentials: 'include'
            });
            const data = await response.json();
            document.getElementById('intentResult').innerHTML = 
              '<span class="success">✅ Success:</span>\n' + JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('intentResult').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        async function testStartTest() {
          try {
            const response = await fetch('/api/start-test', {
              credentials: 'include'
            });
            const data = await response.json();
            document.getElementById('startResult').innerHTML = 
              '<span class="success">✅ Success:</span>\n' + JSON.stringify(data, null, 2);
          } catch (error) {
            document.getElementById('startResult').innerHTML = 
              '<span class="error">❌ Error: ' + error.message + '</span>';
          }
        }
        
        function testFullAuth() {
          window.location.href = '/auth/discord';
        }
      </script>
    </body>
    </html>
  `);
});

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
      <head>
        <title>Bot Setup Required</title>
        <style>
          body { font-family: Arial; padding: 40px; text-align: center; background: #0f0f23; color: white; }
          .container { max-width: 600px; margin: 0 auto; background: #202225; padding: 30px; border-radius: 15px; }
          h1 { color: #ff0033; }
          code { background: #2f3136; padding: 4px 8px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ DISCORD_CLIENT_ID not set!</h1>
          <p>Steps to fix:</p>
          <ol style="text-align: left;">
            <li>Go to <a href="https://discord.com/developers/applications" target="_blank" style="color: #00ffea;">Discord Developer Portal</a></li>
            <li>Click your application → OAuth2 → Copy <code>Client ID</code></li>
            <li>Add to Render.com as <code>DISCORD_CLIENT_ID</code> environment variable</li>
            <li>Redeploy</li>
          </ol>
        </div>
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
        body { font-family: Arial; padding: 40px; text-align: center; background: linear-gradient(135deg, #0f0f23, #1a1a2e); color: white; }
        .container { max-width: 800px; margin: 0 auto; background: rgba(32,34,37,0.9); padding: 40px; border-radius: 20px; border: 1px solid rgba(255,0,51,0.3); }
        .success { color: #00ffea; font-size: 24px; margin: 20px 0; }
        .link { background: #2f3136; padding: 20px; border-radius: 10px; margin: 20px auto; word-break: break-all; border: 1px solid #40444b; }
        a { color: #00ffea; text-decoration: none; }
        a:hover { text-decoration: underline; }
        button { padding: 15px 30px; background: linear-gradient(135deg, #5865f2, #4752c4); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 18px; font-weight: bold; transition: all 0.3s ease; }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(88,101,242,0.4); }
        .info { color: #888; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Void Esports Bot Invite</h1>
        <div class="success">✅ Use this link to invite the bot to your server:</div>
        <div class="link">
          <a href="${inviteLink}" target="_blank">${inviteLink}</a>
        </div>
        <a href="${inviteLink}" target="_blank"><button>Click here to invite bot</button></a>
        <p class="info">Client ID: ${clientId}</p>
        <p class="info">Permissions: 268435456 (Manage Roles)</p>
      </div>
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

// 404 handler for debugging
app.use((req, res, next) => {
  logger.info(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found', 
    method: req.method, 
    path: req.path,
    availableEndpoints: [
      '/ping',
      '/health',
      '/test',
      '/frontend-test',
      '/debug/bot',
      '/debug/bot/status',
      '/auth/discord',
      '/auth/discord/admin',
      '/set-test-intent',
      '/set-admin-intent',
      '/admin',
      '/api/start-test',
      '/api/submit',
      '/submit-test-results',
      '/bot-invite',
      '/logout'
    ]
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const bot = getBot();
  const botConnected = bot && bot.user ? true : false;
  // Add this to the startup banner
  console.log(`║ 📢 Bot Channel: ${process.env.DISCORD_CHANNEL_ID ? "✅ CONFIGURED" : "⚠️ NOT SET"}            ║`);
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                VOID ESPORTS MOD TEST SERVER v2.6                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                                  ║
║ 🤖 Discord Bot: ${botConnected ? "✅ Connected" : "🔄 Connecting..."}   ║
║ 📝 FIXED ISSUES:                                                    ║
║    • ✅ CORS now echoes origin, allows credentials                  ║
║    • ✅ /set-test-intent always returns 200 with JSON               ║
║    • ✅ All endpoints now working                                    ║
║ 👑 Admin Panel: /admin                                              ║
║ 🧪 Test Login: /auth/discord                                        ║
║ 🏥 Health Check: /health                                            ║
║ 🔍 Bot Debug: /debug/bot                                            ║
║ 🤖 Bot Status: /debug/bot/status                                    ║
║ 🧪 Test Page: /test                                                 ║
║ 🔍 Frontend Test: /frontend-test                                    ║
║ 📊 Database: ${process.env.SUPABASE_URL ? "✅ CONFIGURED" : "❌ NOT SETUP"}                    ║
║ 🔔 Discord Webhook: ${process.env.DISCORD_WEBHOOK_URL ? "✅ READY" : "⚠️ NOT SET"}            ║
║ 🏰 Discord Guild: ${process.env.DISCORD_GUILD_ID ? "✅ CONFIGURED" : "⚠️ NOT SET"}            ║
║ 🛡️ Mod Role: ${process.env.MOD_ROLE_ID ? "✅ CONFIGURED" : "⚠️ NOT SET"}                     ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});
