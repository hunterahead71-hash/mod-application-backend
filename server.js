const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits } = require("discord.js");
const MemoryStore = require('memorystore')(session);

const app = express();

/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= DISCORD BOT ================= */

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

bot.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('Discord bot logged in'))
  .catch(console.error);

bot.on('ready', () => {
  console.log(`Discord bot ready as ${bot.user.tag}`);
});

/* ================= CRITICAL FIX: CORS & SESSION ================= */

// 1. CORS configuration
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
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log(`Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
  })
);

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// 2. Session configuration with MemoryStore for production
app.use(
  session({
    store: new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "4d7a9b2f5c8e1a3b6d9f0c2e5a8b1d4f7c0e3a6b9d2f5c8e1a4b7d0c3f6a9b2e5c8f1b4d7e0a3c6b9d2f5e8c1b4a7d0c3f6b9e2c5a8d1b4e7c0a3d6b9e2c5f8",
    resave: false,
    saveUninitialized: false,
    proxy: true, // IMPORTANT for Render
    cookie: {
      secure: true, // Must be true for HTTPS
      sameSite: 'none', // CRITICAL for cross-domain
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      // DO NOT SET domain property for cross-domain
    }
  })
);

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`\n=== ${new Date().toISOString()} ${req.method} ${req.path} ===`);
  console.log('Origin:', req.headers.origin);
  console.log('Cookie Header:', req.headers.cookie || 'No cookies');
  console.log('Session ID:', req.sessionID);
  console.log('Session User:', req.session.user || 'No user');
  console.log('==============================\n');
  next();
});

/* ================= DEBUG ENDPOINTS ================= */

app.get("/debug-session", (req, res) => {
  res.json({
    sessionId: req.sessionID,
    user: req.session.user || 'No user',
    isAdmin: req.session.isAdmin || false,
    testIntent: req.session.testIntent || 'No intent',
    cookies: req.headers.cookie || 'No cookies',
    headers: {
      origin: req.headers.origin,
      cookie: req.headers.cookie
    }
  });
});

app.get("/set-test-session", (req, res) => {
  req.session.user = {
    id: "123456789012345678",
    username: "TestAdmin",
    discriminator: "0001",
    avatar: null,
    public_flags: 0,
    flags: 0,
    banner: null,
    accent_color: null,
    global_name: null,
    avatar_decoration: null,
    banner_color: null,
    mfa_enabled: false,
    locale: "en-US",
    premium_type: 0
  };
  req.session.isAdmin = true;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      success: true, 
      message: "Test session set",
      user: req.session.user,
      sessionId: req.sessionID
    });
  });
});

/* ================= TEST INTENT ================= */

app.post("/set-intent/:intent", (req, res) => {
  const intent = req.params.intent;
  req.session.testIntent = intent;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Session error" });
    }
    res.json({ success: true, intent: intent, sessionId: req.sessionID });
  });
});

app.post("/clear-test-intent", (req, res) => {
  req.session.testIntent = false;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Session error" });
    }
    res.json({ success: true });
  });
});

/* ================= DISCORD AUTH ================= */

app.get("/auth/discord", (req, res) => {
  console.log("Discord auth initiated");
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    console.log("Discord callback received");
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.access_token}`
        }
      }
    );

    console.log("Discord user authenticated:", userRes.data.username);

    // Save Discord user in session
    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    // Check if admin
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
      console.log("User is admin:", userRes.data.username);
    }
    
    // SAVE SESSION BEFORE REDIRECTING
    req.session.save((err) => {
      if (err) {
        console.error("Session save error in callback:", err);
        return res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head><title>Session Error</title></head>
          <body>
            <h1>Session Error</h1>
            <p>Could not save your session. Please try again.</p>
            <p><a href="/auth/discord">Retry Login</a></p>
          </body>
          </html>
        `);
      }
      
      console.log("Session saved successfully, redirecting...");
      console.log("Session ID:", req.sessionID);
      console.log("User:", req.session.user.username);
      console.log("Is Admin:", req.session.isAdmin);
      console.log("Test Intent:", req.session.testIntent);
      
      // For admins, redirect to admin panel
      if (req.session.isAdmin) {
        console.log("Redirecting admin to /admin");
        return res.redirect("/admin");
      }

      // Check if user came from "take test" button
      if (req.session.testIntent === "test") {
        console.log("User has test intent, redirecting to test");
        req.session.testIntent = false;
        req.session.save(() => {
          // Redirect to test page with user info
          const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}`;
          console.log("Redirecting to:", frontendUrl);
          return res.redirect(frontendUrl);
        });
        return;
      }

      // Normal user without test intent
      console.log("Redirecting normal user to homepage");
      return res.redirect("https://hunterahead71-hash.github.io/void.training/");
    });

  } catch (err) {
    console.error("Discord auth error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Auth Error</title></head>
      <body>
        <h1>Discord Authentication Failed</h1>
        <p>${err.message}</p>
        <p><a href="/auth/discord">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

/* ================= AUTH CHECK ================= */

app.get("/me", (req, res) => {
  console.log("Auth check called - Session:", req.session.user);
  
  if (!req.session.user) {
    return res.status(401).json({ 
      authenticated: false,
      message: "No active session",
      sessionId: req.sessionID
    });
  }

  res.json({
    authenticated: true,
    user: req.session.user,
    isAdmin: req.session.isAdmin || false,
    sessionId: req.sessionID
  });
});

/* ================= APPLICATION ================= */

app.post("/apply", async (req, res) => {
  console.log("Apply endpoint called");
  
  if (!req.session.user) {
    console.log("Apply: No user in session");
    return res.status(401).json({ error: "Not authenticated" });
  }

  console.log("Apply: User authenticated", req.session.user.username);
  
  const { answers, score, discordUsername, totalQuestions, correctAnswers, wrongAnswers, testResults } = req.body;

  try {
    const { error } = await supabase.from("applications").insert({
      discord_id: req.session.user.id,
      discord_username: discordUsername || req.session.user.username,
      answers: typeof answers === 'string' ? answers : JSON.stringify(answers),
      score: score,
      total_questions: totalQuestions || 8,
      correct_answers: correctAnswers || 0,
      wrong_answers: wrongAnswers || 0,
      test_results: testResults || {},
      status: "pending",
      created_at: new Date().toISOString()
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true, message: "Application submitted successfully" });
  } catch (err) {
    console.error("Apply error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= GET APPLICATIONS ================= */

app.get("/applications", async (req, res) => {
  console.log("Get applications called");
  
  if (!req.session.user) {
    console.log("Get apps: No user in session");
    return res.status(401).json({ error: "Not authenticated" });
  }

  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  if (!adminIds.includes(req.session.user.id)) {
    console.log("Get apps: User not admin", req.session.user.id);
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ applications: data });
  } catch (err) {
    console.error("Get applications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= ADMIN ================= */

app.get("/admin", async (req, res) => {
  console.log("Admin page accessed - Full session debug:");
  console.log("Session ID:", req.sessionID);
  console.log("Session User:", req.session.user);
  console.log("Session isAdmin:", req.session.isAdmin);
  console.log("Cookies:", req.headers.cookie);
  console.log("Origin:", req.headers.origin);
  
  if (!req.session.user) {
    console.log("Admin: No user in session");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Logged In</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
            margin: 0;
          }
          .debug-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 800px;
            text-align: left;
            font-family: monospace;
            font-size: 12px;
            overflow-x: auto;
          }
          .debug-title {
            color: #ff0033;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .test-links {
            margin: 20px 0;
          }
          .test-links a {
            display: inline-block;
            margin: 5px;
            padding: 10px 15px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-exclamation-triangle"></i> Not Logged In</h1>
        <p>Your session has expired or cookies are blocked.</p>
        
        <div class="test-links">
          <a href="/auth/discord"><i class="fab fa-discord"></i> Login with Discord</a>
          <a href="/set-test-session" target="_blank"><i class="fas fa-vial"></i> Set Test Session</a>
          <a href="/debug-session" target="_blank"><i class="fas fa-bug"></i> Debug Session</a>
        </div>
        
        <div class="debug-info">
          <div class="debug-title">Session Debug Info:</div>
          <div><strong>Session ID:</strong> ${req.sessionID || 'None'}</div>
          <div><strong>User in Session:</strong> ${req.session.user ? 'Yes' : 'No'}</div>
          <div><strong>Cookie Header:</strong> ${req.headers.cookie || 'None'}</div>
          <div><strong>Origin Header:</strong> ${req.headers.origin || 'None'}</div>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: #202225; border-radius: 10px; max-width: 800px; margin: 20px auto;">
          <h3><i class="fas fa-question-circle"></i> Troubleshooting Steps:</h3>
          <ol style="text-align: left; max-width: 600px; margin: 0 auto;">
            <li>Click "Set Test Session" link above first</li>
            <li>Then click "Debug Session" to see if session was saved</li>
            <li>If session shows, then click "Login with Discord"</li>
            <li>Make sure cookies are enabled in your browser</li>
            <li>Try Chrome/Edge (Firefox sometimes blocks cross-site cookies)</li>
            <li>Make sure you're not in Incognito/Private mode</li>
          </ol>
        </div>
        
        <p style="margin-top: 30px; font-size: 12px; color: #72767d;">
          If you keep seeing this error, the issue is with browser cookies not being saved between GitHub Pages and Render.
        </p>
      </body>
      </html>
    `);
  }
  
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  if (!adminIds.includes(req.session.user.id)) {
    console.log("Admin: User not in admin list", req.session.user.id);
    console.log("Admin IDs required:", adminIds);
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
          }
          h1 { color: #ff0033; }
          .user-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 20px auto;
            max-width: 500px;
          }
        </style>
      </head>
      <body>
        <h1>Access Denied</h1>
        <p>You do not have admin privileges.</p>
        
        <div class="user-info">
          <p><strong>Your Discord ID:</strong> ${req.session.user.id}</p>
          <p><strong>Your Username:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
          <p><strong>Admin IDs Required:</strong> ${adminIds.join(', ')}</p>
        </div>
        
        <p><a href="/logout" style="color: #5865f2;">Logout</a></p>
        
        <div style="margin-top: 30px; font-size: 12px; color: #72767d;">
          If you believe you should have admin access, check your Discord ID is in the ADMIN_IDS environment variable.
        </div>
      </body>
      </html>
    `);
  }

  console.log("Admin: User is admin, loading applications");
  
  try {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Database Error</title></head>
        <body>
          <h1>Database Error</h1>
          <p>Could not load applications.</p>
          <p><a href="/admin">Try Again</a></p>
        </body>
        </html>
      `);
    }

    // Enhanced admin HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          :root {
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: Arial, sans-serif;
            background: var(--discord-bg);
            color: #ffffff;
            min-height: 100vh;
            padding: 20px;
          }
          
          .admin-container {
            max-width: 1400px;
            margin: 0 auto;
          }
          
          .header {
            background: var(--discord-primary);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .header h1 {
            color: var(--void-blood);
            font-size: 28px;
          }
          
          .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          
          .user-avatar {
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--void-blood), var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 20px;
          }
          
          .logout-btn {
            background: var(--discord-red);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s;
          }
          
          .logout-btn:hover {
            background: #ff3333;
            transform: translateY(-2px);
          }
          
          .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: var(--discord-primary);
            padding: 20px;
            border-radius: 12px;
            text-align: center;
          }
          
          .stat-number {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          
          .stat-label {
            color: #888;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .total { color: var(--void-neon); }
          .pending { color: #f59e0b; }
          .accepted { color: var(--discord-green); }
          .rejected { color: var(--discord-red); }
          
          .filters {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          
          .filter-btn {
            background: var(--discord-primary);
            color: #888;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
          }
          
          .filter-btn.active {
            background: var(--void-blood);
            color: white;
          }
          
          .filter-btn:hover:not(.active) {
            background: #333;
            color: white;
          }
          
          .applications-grid {
            display: grid;
            gap: 15px;
          }
          
          .application-card {
            background: var(--discord-primary);
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #888;
          }
          
          .application-card.pending { border-left-color: #f59e0b; }
          .application-card.accepted { border-left-color: var(--discord-green); }
          .application-card.rejected { border-left-color: var(--discord-red); }
          
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .app-user {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .app-avatar {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #8b5cf6, var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
          }
          
          .app-info h3 {
            font-size: 18px;
            margin-bottom: 5px;
          }
          
          .app-info p {
            color: #888;
            font-size: 14px;
          }
          
          .app-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .status-pending { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .status-accepted { background: rgba(59, 165, 92, 0.2); color: var(--discord-green); }
          .status-rejected { background: rgba(237, 66, 69, 0.2); color: var(--discord-red); }
          
          .app-details {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
          }
          
          .score-display {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          
          .score-value {
            font-size: 24px;
            font-weight: bold;
            color: var(--void-neon);
          }
          
          .app-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }
          
          .action-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
          }
          
          .accept-btn {
            background: var(--discord-green);
            color: white;
          }
          
          .reject-btn {
            background: var(--discord-red);
            color: white;
          }
          
          .action-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .no-applications {
            text-align: center;
            padding: 50px;
            color: #888;
            font-size: 18px;
          }
          
          .answers-content {
            margin-top: 10px;
            padding: 10px;
            background: rgba(0,0,0,0.5);
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            max-height: 200px;
            overflow-y: auto;
            display: none;
          }
          
          .answers-content.show {
            display: block;
          }
          
          .view-answers-btn {
            background: none;
            border: none;
            color: var(--void-neon);
            cursor: pointer;
            font-size: 14px;
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 5px;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="header">
            <h1><i class="fas fa-shield-alt"></i> VOID ESPORTS - ADMIN DASHBOARD</h1>
            <div class="user-info">
              <div class="user-avatar">${req.session.user.username.charAt(0).toUpperCase()}</div>
              <div>
                <div>${req.session.user.username}#${req.session.user.discriminator}</div>
                <div style="font-size: 12px; color: #888;">Admin • Session: ${req.sessionID.substring(0, 8)}...</div>
              </div>
              <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            </div>
          </div>
          
          <div class="stats-container">
            <div class="stat-card">
              <div class="stat-number total">${data.length}</div>
              <div class="stat-label">Total Applications</div>
            </div>
            <div class="stat-card">
              <div class="stat-number pending">${data.filter(a => a.status === 'pending').length}</div>
              <div class="stat-label">Pending</div>
            </div>
            <div class="stat-card">
              <div class="stat-number accepted">${data.filter(a => a.status === 'accepted').length}</div>
              <div class="stat-label">Accepted</div>
            </div>
            <div class="stat-card">
              <div class="stat-number rejected">${data.filter(a => a.status === 'rejected').length}</div>
              <div class="stat-label">Rejected</div>
            </div>
          </div>
          
          <div class="filters">
            <button class="filter-btn active" onclick="filterApplications('all')">All (${data.length})</button>
            <button class="filter-btn" onclick="filterApplications('pending')">Pending (${data.filter(a => a.status === 'pending').length})</button>
            <button class="filter-btn" onclick="filterApplications('accepted')">Accepted (${data.filter(a => a.status === 'accepted').length})</button>
            <button class="filter-btn" onclick="filterApplications('rejected')">Rejected (${data.filter(a => a.status === 'rejected').length})</button>
          </div>
          
          <div class="applications-grid" id="applicationsContainer">
    `;

    if (data.length === 0) {
      html += `
        <div class="no-applications">
          <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px;"></i>
          <p>No applications submitted yet.</p>
        </div>
      `;
    }

    data.forEach((app, index) => {
      const score = app.score ? app.score.split('/') : ['0', '8'];
      const scoreValue = parseInt(score[0]);
      const totalQuestions = parseInt(score[1]);
      const percentage = totalQuestions > 0 ? Math.round((scoreValue / totalQuestions) * 100) : 0;
      
      html += `
        <div class="application-card ${app.status}" id="app-${app.id}" data-status="${app.status}">
          <div class="app-header">
            <div class="app-user">
              <div class="app-avatar">${app.discord_username.charAt(0).toUpperCase()}</div>
              <div class="app-info">
                <h3>${app.discord_username}</h3>
                <p>ID: ${app.discord_id} • ${new Date(app.created_at).toLocaleString()}</p>
              </div>
            </div>
            <div class="app-status status-${app.status}">${app.status.toUpperCase()}</div>
          </div>
          
          <div class="app-details">
            <div class="score-display">
              <div class="score-value">${scoreValue}/${totalQuestions}</div>
              <div style="color: #888;">${percentage}% • ${app.correct_answers || 0} correct</div>
            </div>
            
            <button class="view-answers-btn" onclick="toggleAnswers(${app.id})">
              <i class="fas fa-chevron-down"></i> View Test Details
            </button>
            
            <div class="answers-content" id="answers-${app.id}">
              ${app.answers ? app.answers.substring(0, 500).replace(/\n/g, '<br>') : 'No answers provided'}
              ${app.answers && app.answers.length > 500 ? '...' : ''}
            </div>
            
            <div class="app-actions">
      `;
      
      if (app.status === "pending") {
        html += `
              <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept')">
                <i class="fas fa-check"></i> Accept & Grant Mod Role
              </button>
              <button class="action-btn reject-btn" onclick="processApplication(${app.id}, 'reject')">
                <i class="fas fa-times"></i> Reject
              </button>
        `;
      } else {
        html += `
              <button class="action-btn" disabled>
                <i class="fas fa-${app.status === 'accepted' ? 'check' : 'times'}"></i>
                ${app.status === 'accepted' ? 'Accepted' : 'Rejected'} on ${new Date(app.updated_at || app.created_at).toLocaleDateString()}
              </button>
        `;
      }
      
      html += `
            </div>
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
        
        <script>
          function filterApplications(status) {
            const cards = document.querySelectorAll('.application-card');
            const buttons = document.querySelectorAll('.filter-btn');
            
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            cards.forEach(card => {
              if (status === 'all' || card.dataset.status === status) {
                card.style.display = 'block';
              } else {
                card.style.display = 'none';
              }
            });
          }
          
          function toggleAnswers(appId) {
            const answersDiv = document.getElementById('answers-' + appId);
            const toggleBtn = answersDiv.previousElementSibling;
            const icon = toggleBtn.querySelector('i');
            
            if (answersDiv.classList.contains('show')) {
              answersDiv.classList.remove('show');
              icon.className = 'fas fa-chevron-down';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> View Test Details';
            } else {
              answersDiv.classList.add('show');
              icon.className = 'fas fa-chevron-up';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Details';
            }
          }
          
          async function processApplication(appId, action) {
            const btn = event.target;
            const originalText = btn.innerHTML;
            
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            try {
              const response = await fetch('/admin/' + action + '/' + appId, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Failed to process application');
                btn.innerHTML = originalText;
                btn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('An error occurred');
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error("Admin error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Server Error</title></head>
      <body>
        <h1>Server Error</h1>
        <p>${err.message}</p>
        <p><a href="/admin">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

/* ================= ADMIN ACTIONS ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    const id = req.params.id;
    console.log("Accept application:", id);

    if (!req.session.user) {
      console.log("Accept: No user in session");
      return res.status(401).json({ error: "Not logged in" });
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
      console.log("Accept: User not admin", req.session.user.id);
      return res.status(403).json({ error: "Forbidden" });
    }

    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !application) {
      console.error("Application not found:", fetchError);
      return res.status(404).json({ error: "Application not found" });
    }

    console.log("Accepting application for:", application.discord_username);

    // Assign mod role using Discord bot
    try {
      const guild = await bot.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(application.discord_id);
      await member.roles.add(process.env.MOD_ROLE_ID);
      
      console.log(`Assigned mod role to ${application.discord_username} (${application.discord_id})`);
      
      // Send DM to user
      try {
        const dmChannel = await member.createDM();
        await dmChannel.send({
          embeds: [{
            title: "🎉 Congratulations!",
            description: `Your Void Esports moderator application has been **ACCEPTED**!\n\n**Score:** ${application.score}\n\nWelcome to the team! Please read the mod guidelines in the server.`,
            color: 0x00ff00,
            timestamp: new Date().toISOString()
          }]
        });
        console.log("Sent acceptance DM to", application.discord_username);
      } catch (dmError) {
        console.log("Could not send DM (user might have DMs disabled)");
      }
      
    } catch (discordError) {
      console.error("Discord role assignment error:", discordError);
      // Continue anyway, but log the error
    }

    // Update application status
    await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    res.json({ success: true, message: "Application accepted" });
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).json({ error: "Failed to process acceptance" });
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    const id = req.params.id;
    console.log("Reject application:", id);

    if (!req.session.user) {
      console.log("Reject: No user in session");
      return res.status(401).json({ error: "Not logged in" });
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
      console.log("Reject: User not admin", req.session.user.id);
      return res.status(403).json({ error: "Forbidden" });
    }

    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !application) {
      console.error("Application not found:", fetchError);
      return res.status(404).json({ error: "Application not found" });
    }

    console.log("Rejecting application for:", application.discord_username);

    // Send rejection DM
    try {
      const guild = await bot.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(application.discord_id);
      
      const dmChannel = await member.createDM();
      await dmChannel.send({
        embeds: [{
          title: "⚠️ Application Update",
          description: `Your Void Esports moderator application has been **REJECTED**.\n\n**Score:** ${application.score}\n\nYou can re-apply after 30 days.`,
          color: 0xff0000,
          timestamp: new Date().toISOString()
        }]
      });
      console.log("Sent rejection DM to", application.discord_username);
    } catch (dmError) {
      console.log("Could not send rejection DM");
    }

    // Update application status
    await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    res.json({ success: true, message: "Application rejected" });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Failed to process rejection" });
  }
});

/* ================= LOGOUT ================= */

app.get("/logout", (req, res) => {
  console.log("Logout called for session:", req.sessionID);
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
    }
    res.redirect("https://hunterahead71-hash.github.io/void.training/");
  });
});

/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    session: req.session.user ? "active" : "none",
    sessionId: req.sessionID,
    cookies: req.headers.cookie || "none",
    origin: req.headers.origin || "none"
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🌐 CORS enabled for: https://hunterahead71-hash.github.io`);
  console.log(`🍪 Session settings: secure=true, sameSite=none`);
  console.log(`🔧 Debug endpoints: /debug-session, /set-test-session`);
  console.log(`👑 Admin login: /auth/discord`);
  console.log(`🏥 Health check: /health\n`);
});
