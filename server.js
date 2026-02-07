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

/* ================= FIXED CORS & SESSION ================= */

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
        console.log(`Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
  })
);

app.options('*', cors());
app.use(express.json());

// CRITICAL FIX: Session configuration
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
  console.log(`\n=== ${new Date().toISOString()} ${req.method} ${req.path} ===`);
  console.log('Origin:', req.headers.origin);
  console.log('Cookie Header:', req.headers.cookie || 'No cookies');
  console.log('Session ID:', req.sessionID);
  console.log('Session User:', req.session.user || 'No user');
  console.log('Session Intent:', req.session.loginIntent || 'No intent');
  console.log('==============================\n');
  next();
});

/* ================= DEBUG ENDPOINTS ================= */

app.get("/debug-session", (req, res) => {
  res.json({
    sessionId: req.sessionID,
    user: req.session.user || 'No user',
    isAdmin: req.session.isAdmin || false,
    loginIntent: req.session.loginIntent || 'No intent',
    cookies: req.headers.cookie || 'No cookies'
  });
});

/* ================= TEST INTENT - FIXED ================= */

// Store intents in memory as backup
const pendingIntents = new Map();

app.get("/set-test-intent", (req, res) => {
  console.log("Setting test intent...");
  req.session.loginIntent = "test";
  pendingIntents.set(req.sessionID, {
    intent: "test",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      success: true, 
      message: "Test intent set",
      loginIntent: req.session.loginIntent,
      sessionId: req.sessionID
    });
  });
});

app.get("/set-admin-intent", (req, res) => {
  console.log("Setting admin intent...");
  req.session.loginIntent = "admin";
  pendingIntents.set(req.sessionID, {
    intent: "admin",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      success: true, 
      message: "Admin intent set",
      loginIntent: req.session.loginIntent,
      sessionId: req.sessionID
    });
  });
});

/* ================= DISCORD AUTH - FIXED ================= */

app.get("/auth/discord", (req, res) => {
  console.log("Discord auth initiated for TEST");
  console.log("Current session intent:", req.session.loginIntent);
  
  // Set test intent if not already set
  if (!req.session.loginIntent) {
    req.session.loginIntent = "test";
  }
  
  // Store in memory as backup
  pendingIntents.set(req.sessionID, {
    intent: "test",
    timestamp: Date.now()
  });
  
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/admin", (req, res) => {
  console.log("Discord auth initiated for ADMIN");
  console.log("Current session intent:", req.session.loginIntent);
  
  // Set admin intent
  req.session.loginIntent = "admin";
  
  // Store in memory as backup
  pendingIntents.set(req.sessionID, {
    intent: "admin",
    timestamp: Date.now()
  });
  
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    console.log("\n=== DISCORD CALLBACK START ===");
    console.log("Session ID:", req.sessionID);
    console.log("Session loginIntent:", req.session.loginIntent);
    console.log("Pending intents for this session:", pendingIntents.get(req.sessionID));
    
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

    // Get Discord token
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

    // Get user info
    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.access_token}`
        }
      }
    );

    console.log("Discord user authenticated:", userRes.data.username);
    console.log("User ID:", userRes.data.id);

    // Save user in session
    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    // Check if admin
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    console.log("Admin IDs:", adminIds);
    console.log("User ID for check:", userRes.data.id);
    
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
      console.log("User is admin:", userRes.data.username);
    }
    
    // Check intent from session or memory backup
    let intent = req.session.loginIntent;
    if (!intent && pendingIntents.has(req.sessionID)) {
      intent = pendingIntents.get(req.sessionID).intent;
      req.session.loginIntent = intent;
    }
    
    console.log("Final determined intent:", intent);
    
    // Clean up memory backup
    if (pendingIntents.has(req.sessionID)) {
      pendingIntents.delete(req.sessionID);
    }
    
    // SAVE SESSION
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
      
      console.log("Session saved successfully!");
      console.log("User in session:", req.session.user.username);
      console.log("Is Admin:", req.session.isAdmin);
      console.log("Login Intent:", req.session.loginIntent);
      
      // FOR ADMINS WITH ADMIN INTENT: Redirect to admin panel
      if (req.session.isAdmin && intent === "admin") {
        console.log("Redirecting admin to /admin");
        req.session.loginIntent = null; // Clear intent
        req.session.save(() => {
          return res.redirect("/admin");
        });
        return;
      }
      
      // FOR REGULAR USERS WHO ACCIDENTALLY CLICKED ADMIN LOGIN
      if (intent === "admin" && !req.session.isAdmin) {
        console.log("Non-admin trying to access admin panel");
        req.session.loginIntent = null;
        req.session.save(() => {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Access Denied</title>
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
                h1 { color: #ff0033; }
                .error-container {
                  background: #202225;
                  padding: 40px;
                  border-radius: 12px;
                  margin: 30px auto;
                  max-width: 600px;
                  text-align: left;
                }
                .user-info {
                  background: #2f3136;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 20px 0;
                }
                .contact-link {
                  color: #5865f2;
                  font-weight: bold;
                  text-decoration: none;
                }
                .contact-link:hover {
                  text-decoration: underline;
                }
                .action-buttons {
                  margin-top: 30px;
                  display: flex;
                  gap: 15px;
                  justify-content: center;
                  flex-wrap: wrap;
                }
                .action-btn {
                  padding: 12px 24px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-weight: bold;
                  color: white;
                  display: inline-flex;
                  align-items: center;
                  gap: 8px;
                }
                .test-btn {
                  background: #5865f2;
                }
                .home-btn {
                  background: #3ba55c;
                }
              </style>
            </head>
            <body>
              <h1><i class="fas fa-ban"></i> Access Denied</h1>
              <p>You don't have administrator privileges.</p>
              
              <div class="error-container">
                <div class="user-info">
                  <p><strong>Your Discord:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
                  <p><strong>Your ID:</strong> ${req.session.user.id}</p>
                </div>
                
                <p>If you need admin access, contact <a href="https://discord.com/users/727888300210913310" class="contact-link" target="_blank">@nicksscold</a> on Discord.</p>
                
                <p>If you were trying to take the moderator test, use the "Begin Certification Test" button on the training page.</p>
              </div>
              
              <div class="action-buttons">
                <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn home-btn">
                  <i class="fas fa-home"></i> Return to Training
                </a>
                <a href="/auth/discord" class="action-btn test-btn">
                  <i class="fas fa-vial"></i> Take Mod Test Instead
                </a>
              </div>
            </body>
            </html>
          `);
        });
        return;
      }
      
      // FOR REGULAR USERS WITH TEST INTENT: Redirect to test
      if (intent === "test") {
        console.log("User has test intent, redirecting to test interface");
        req.session.loginIntent = null; // Clear after use
        
        req.session.save(() => {
          // Create redirect URL with user data
          const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}&timestamp=${Date.now()}`;
          console.log("Redirecting to test:", frontendUrl);
          
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Redirecting to Test...</title>
              <script>
                window.location.href = "${frontendUrl}";
              </script>
            </head>
            <body>
              <p>Redirecting to test... Please wait.</p>
              <p>If you are not redirected, <a href="${frontendUrl}">click here</a>.</p>
            </body>
            </html>
          `);
        });
        return;
      }
      
      // FOR ANY OTHER CASE (no intent): Redirect to homepage
      console.log("No specific intent, redirecting to homepage");
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
  console.log("Auth check called");
  
  if (!req.session.user) {
    return res.status(401).json({ 
      authenticated: false,
      message: "No active session"
    });
  }

  res.json({
    authenticated: true,
    user: req.session.user,
    isAdmin: req.session.isAdmin || false,
    sessionId: req.sessionID,
    loginIntent: req.session.loginIntent || null
  });
});

/* ================= ADMIN PAGE - FIXED ================= */

app.get("/admin", async (req, res) => {
  console.log("\n=== ADMIN PAGE ACCESS ===");
  console.log("Session User:", req.session.user || 'No user');
  console.log("Session isAdmin:", req.session.isAdmin);
  console.log("Admin IDs:", process.env.ADMIN_IDS);
  
  // Check if user is logged in
  if (!req.session.user) {
    console.log("No user in session, redirecting to login");
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
          h1 { color: #ff0033; }
          .login-btn {
            display: inline-block;
            margin: 20px;
            padding: 15px 30px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 18px;
          }
          .login-btn:hover {
            background: #4752c4;
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
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-exclamation-triangle"></i> Not Logged In</h1>
        <p>You need to log in with Discord to access the admin panel.</p>
        
        <a href="/auth/discord/admin" class="login-btn">
          <i class="fab fa-discord"></i> Login with Discord
        </a>
        
        <div class="debug-info">
          <strong>Debug Info:</strong><br>
          Session ID: ${req.sessionID || 'None'}<br>
          User in Session: ${req.session.user ? 'Yes' : 'No'}<br>
          Cookie Header: ${req.headers.cookie || 'None'}
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if user is admin
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  const userId = req.session.user.id;
  
  console.log("Checking if user is admin:");
  console.log("User ID:", userId);
  console.log("Admin IDs:", adminIds);
  console.log("Is user in admin list?", adminIds.includes(userId));
  
  if (!adminIds.includes(userId)) {
    console.log("User is NOT an admin");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
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
          h1 { color: #ff0033; }
          .user-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 600px;
            text-align: left;
          }
          .contact-link {
            color: #5865f2;
            font-weight: bold;
            text-decoration: none;
          }
          .contact-link:hover {
            text-decoration: underline;
          }
          .action-buttons {
            margin-top: 30px;
          }
          .action-btn {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
          }
          .logout-btn {
            background: #ed4245;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-ban"></i> Access Denied</h1>
        <p>You don't have administrator privileges.</p>
        
        <div class="user-info">
          <p><strong>Your Discord:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
          <p><strong>Your ID:</strong> ${req.session.user.id}</p>
          <p><strong>Your session ID:</strong> ${req.sessionID}</p>
        </div>
        
        <p>If you need admin access, contact <a href="https://discord.com/users/727888300210913310" class="contact-link" target="_blank">@nicksscold</a> on Discord.</p>
        
        <div class="action-buttons">
          <a href="/logout" class="action-btn logout-btn">
            <i class="fas fa-sign-out-alt"></i> Logout
          </a>
          <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn">
            <i class="fas fa-home"></i> Return to Training
          </a>
          <a href="/auth/discord" class="action-btn">
            <i class="fas fa-vial"></i> Take Mod Test
          </a>
        </div>
      </body>
      </html>
    `);
  }

  console.log("User is admin, loading applications...");
  
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

    // Admin dashboard HTML
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          body {
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .logout-btn {
            background: var(--discord-red);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .stat-label {
            color: #888;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info h3 {
            font-size: 18px;
            margin-bottom: 5px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info p {
            color: #888;
            font-size: 14px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .answers-content {
            margin-top: 10px;
            padding: 10px;
            background: rgba(0,0,0,0.5);
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
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
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
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

/* ================= APPLICATION SUBMISSION ================= */

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
  console.log(`🍪 Session settings: secure=true, sameSite=none, resave=true`);
  console.log(`🔧 Debug endpoints: /debug-session`);
  console.log(`👑 Admin login: /auth/discord/admin`);
  console.log(`🧪 Test login: /auth/discord`);
  console.log(`🏥 Health check: /health`);
  console.log(`🎯 Set test intent: /set-test-intent`);
  console.log(`🛡️ Set admin intent: /set-admin-intent\n`);
});
