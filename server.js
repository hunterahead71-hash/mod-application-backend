const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits } = require("discord.js");

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

/* ================= CRITICAL FIX: CORS & SESSION ================= */

// 1. CORS must be configured BEFORE session middleware
app.use(
  cors({
    origin: [
      "https://hunterahead71-hash.github.io",
      "http://localhost:3000",
      "http://localhost:5500",
      "http://localhost:8000"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
  })
);

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// 2. Session configuration for cross-domain
app.use(
  session({
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "4d7a9b2f5c8e1a3b6d9f0c2e5a8b1d4f7c0e3a6b9d2f5c8e1a4b7d0c3f6a9b2e5c8f1b4d7e0a3c6b9d2f5e8c1b4a7d0c3f6b9e2c5a8d1b4e7c0a3d6b9e2c5f8",
    resave: true,
    saveUninitialized: true,
    proxy: true, // IMPORTANT for Render
    cookie: {
      secure: true, // Must be true for HTTPS
      sameSite: 'none', // CRITICAL for cross-domain
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      domain: '.onrender.com' // Allows cookies across Render subdomains
    }
  })
);

/* ================= TEST INTENT ================= */

app.post("/set-intent/:intent", (req, res) => {
  const intent = req.params.intent;
  req.session.testIntent = intent;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Session error" });
    }
    res.json({ success: true, intent: intent });
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
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
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

    // Save Discord user in session
    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    // Check if admin
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
    }
    
    // SAVE SESSION BEFORE REDIRECTING
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Session error");
      }
      
      // For admins, redirect to admin panel
      if (req.session.isAdmin) {
        return res.redirect("/admin");
      }

      // Check if user came from "take test" button
      if (req.session.testIntent === "test") {
        req.session.testIntent = false;
        req.session.save(() => {
          // Redirect to test page with user info
          const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}`;
          return res.redirect(frontendUrl);
        });
        return;
      }

      // Normal user without test intent
      return res.redirect("https://hunterahead71-hash.github.io/void.training/");
    });

  } catch (err) {
    console.error("Discord auth error:", err);
    res.status(500).send("Discord authentication failed");
  }
});

/* ================= AUTH CHECK ================= */

app.get("/me", (req, res) => {
  console.log("Session check:", req.sessionID, req.session.user);
  
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
    sessionId: req.sessionID
  });
});

/* ================= ADMIN ================= */

app.get("/admin", async (req, res) => {
  console.log("Admin access attempt - Session:", req.session.user);
  
  if (!req.session.user) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Logged In</title>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
          }
          .container {
            background: #202225;
            padding: 40px;
            border-radius: 10px;
            max-width: 500px;
            margin: 0 auto;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          h1 { color: #ff0033; margin-bottom: 20px; }
          .login-btn {
            background: #5865f2;
            color: white;
            padding: 15px 30px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            display: inline-block;
            margin-top: 20px;
            transition: all 0.3s;
          }
          .login-btn:hover {
            background: #4752c4;
            transform: translateY(-2px);
          }
          .error {
            color: #ed4245;
            background: rgba(237, 66, 69, 0.1);
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .steps {
            text-align: left;
            margin-top: 30px;
            padding: 20px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
          }
          .steps li {
            margin-bottom: 10px;
            color: #b9bbbe;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><i class="fas fa-exclamation-triangle"></i> Not Logged In</h1>
          <div class="error">
            Your session has expired or cookies are blocked.
          </div>
          <p>Please login with Discord to access the admin panel.</p>
          
          <div class="steps">
            <strong>If you keep seeing this error:</strong>
            <ol>
              <li>Make sure cookies are enabled in your browser</li>
              <li>Try using Chrome/Edge browser (Firefox sometimes blocks cross-site cookies)</li>
              <li>Make sure you're using the same browser where you logged in</li>
              <li>Clear cookies for this site and try again</li>
            </ol>
          </div>
          
          <a href="/auth/discord" class="login-btn">
            <i class="fab fa-discord"></i> Login with Discord
          </a>
          
          <p style="margin-top: 30px; font-size: 12px; color: #72767d;">
            Session Debug: ${req.sessionID ? 'Session exists' : 'No session'} • 
            User: ${req.session.user ? 'Logged in' : 'Not logged in'}
          </p>
        </div>
      </body>
      </html>
    `);
  }
  
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  if (!adminIds.includes(req.session.user.id)) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          h1 { color: #ff0033; }
        </style>
      </head>
      <body>
        <h1>Access Denied</h1>
        <p>You do not have admin privileges.</p>
        <p>Your Discord ID: ${req.session.user.id}</p>
        <p>Admin IDs required: ${adminIds.join(', ')}</p>
        <p><a href="/logout">Logout</a></p>
      </body>
      </html>
    `);
  }

  try {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).send("Database error");
    }

    // Admin HTML (same as before, but with better session info)
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background: #36393f;
            color: white;
          }
          .header {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
          }
          .logout-btn {
            background: #ed4245;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            text-decoration: none;
            float: right;
          }
          .app-card {
            background: #2f3136;
            border-radius: 8px;
            padding: 20px;
            margin: 10px 0;
            border-left: 4px solid #72767d;
          }
          .app-card.pending { border-left-color: #faa81a; }
          .app-card.accepted { border-left-color: #3ba55c; }
          .app-card.rejected { border-left-color: #ed4245; }
          .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
          }
          .btn-accept { background: #3ba55c; color: white; }
          .btn-reject { background: #ed4245; color: white; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Admin Dashboard</h1>
          <p>Logged in as: ${req.session.user.username}#${req.session.user.discriminator} (ID: ${req.session.user.id})</p>
          <a href="/logout" class="logout-btn">Logout</a>
          <div style="clear: both;"></div>
        </div>
        
        <h3>Total Applications: ${data.length}</h3>
    `;

    if (data.length === 0) {
      html += `<p>No applications yet.</p>`;
    }

    data.forEach(app => {
      html += `
        <div class="app-card ${app.status}">
          <h4>${app.discord_username} (ID: ${app.discord_id})</h4>
          <p>Score: ${app.score} • Submitted: ${new Date(app.created_at).toLocaleString()}</p>
          <p>Status: <strong>${app.status}</strong></p>
          ${app.status === 'pending' ? `
            <button class="btn btn-accept" onclick="acceptApp(${app.id})">Accept</button>
            <button class="btn btn-reject" onclick="rejectApp(${app.id})">Reject</button>
          ` : ''}
        </div>
      `;
    });

    html += `
        <script>
          async function acceptApp(id) {
            if (confirm('Accept this applicant and assign mod role?')) {
              const response = await fetch('/admin/accept/' + id, { method: 'POST' });
              if (response.ok) location.reload();
            }
          }
          
          async function rejectApp(id) {
            if (confirm('Reject this applicant?')) {
              const response = await fetch('/admin/reject/' + id, { method: 'POST' });
              if (response.ok) location.reload();
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error("Admin error:", err);
    res.status(500).send("Server error");
  }
});

/* ================= ADMIN ACTIONS ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
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

    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
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
    cookies: req.headers.cookie || "none"
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS enabled for: https://hunterahead71-hash.github.io`);
  console.log(`Session cookie settings: secure=true, sameSite=none`);
});
