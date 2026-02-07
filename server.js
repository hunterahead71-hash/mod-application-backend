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

// Login bot
bot.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('Discord bot logged in'))
  .catch(console.error);

bot.on('ready', () => {
  console.log(`Discord bot ready as ${bot.user.tag}`);
});

/* ================= MIDDLEWARE ================= */

// CORS configuration
app.use(
  cors({
    origin: [
      "https://hunterahead71-hash.github.io",
      "http://localhost:3000",
      "http://localhost:5500"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  })
);

app.use(express.json());

// Session configuration
app.use(
  session({
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "super-secret-key-change-in-production",
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true
    }
  })
);

/* ================= TEST INTENT ================= */

app.post("/set-intent/:intent", (req, res) => {
  const intent = req.params.intent;
  req.session.testIntent = intent;
  req.session.save();
  res.json({ success: true, intent: intent });
});

app.post("/clear-test-intent", (req, res) => {
  req.session.testIntent = false;
  req.session.save();
  res.json({ success: true });
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
    
    req.session.save();

    // For admins, redirect to admin panel
    if (req.session.isAdmin) {
      return res.redirect("/admin");
    }

    // Check if user came from "take test" button
    if (req.session.testIntent === "test") {
      req.session.testIntent = false;
      req.session.save();
      
      // Redirect to test page with user info
      const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}&discord_discriminator=${userRes.data.discriminator}`;
      return res.redirect(frontendUrl);
    }

    // Normal user without test intent
    return res.redirect("https://hunterahead71-hash.github.io/void.training/");

  } catch (err) {
    console.error("Discord auth error:", err);
    res.status(500).send("Discord authentication failed");
  }
});

/* ================= AUTH CHECK ================= */

app.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: req.session.user,
    isAdmin: req.session.isAdmin || false
  });
});

/* ================= APPLICATION ================= */

app.post("/apply", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

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
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  if (!adminIds.includes(req.session.user.id)) {
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
  if (!req.session.user) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Logged In</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          h1 { color: #ff0033; }
          a { color: #5865f2; text-decoration: none; }
        </style>
      </head>
      <body>
        <h1>Not Logged In</h1>
        <p>Please <a href="/auth/discord">login with Discord</a> first.</p>
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

    // Enhanced admin HTML with better UI
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --void-purple: #8b5cf6;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-secondary: #2f3136;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Space Grotesk', sans-serif;
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
            background: linear-gradient(135deg, var(--void-blood), var(--void-purple));
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
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: var(--discord-primary);
            padding: 25px;
            border-radius: 12px;
            text-align: center;
          }
          
          .stat-number {
            font-size: 48px;
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
            margin-bottom: 30px;
            flex-wrap: wrap;
          }
          
          .filter-btn {
            background: var(--discord-primary);
            color: #888;
            border: none;
            padding: 12px 24px;
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
            gap: 20px;
          }
          
          .application-card {
            background: var(--discord-primary);
            border-radius: 12px;
            padding: 25px;
            border-left: 4px solid #888;
            transition: all 0.3s;
          }
          
          .application-card.pending { border-left-color: #f59e0b; }
          .application-card.accepted { border-left-color: var(--discord-green); }
          .application-card.rejected { border-left-color: var(--discord-red); }
          
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          
          .app-user {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          
          .app-avatar {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, var(--void-purple), var(--void-neon));
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
            padding: 8px 16px;
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
            padding: 20px;
            margin-top: 20px;
          }
          
          .score-display {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 15px;
          }
          
          .score-value {
            font-size: 32px;
            font-weight: bold;
            color: var(--void-neon);
          }
          
          .score-label {
            color: #888;
          }
          
          .details-toggle {
            background: none;
            border: none;
            color: var(--void-neon);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 15px;
            font-weight: bold;
          }
          
          .answers-content {
            margin-top: 15px;
            padding: 15px;
            background: rgba(0,0,0,0.5);
            border-radius: 8px;
            display: none;
            white-space: pre-wrap;
            font-family: monospace;
            max-height: 300px;
            overflow-y: auto;
          }
          
          .answers-content.show {
            display: block;
          }
          
          .app-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
          }
          
          .action-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
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
          
          .action-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
          }
          
          .no-applications {
            text-align: center;
            padding: 50px;
            color: #888;
            font-size: 18px;
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
                <div style="font-size: 12px; color: #888;">Admin</div>
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

    data.forEach(app => {
      const score = app.score ? app.score.split('/') : ['0', '8'];
      const scoreValue = parseInt(score[0]);
      const totalQuestions = parseInt(score[1]);
      const percentage = totalQuestions > 0 ? Math.round((scoreValue / totalQuestions) * 100) : 0;
      
      let testResults = {};
      try {
        testResults = app.test_results ? JSON.parse(app.test_results) : {};
      } catch (e) {
        testResults = {};
      }
      
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
              <div class="score-label">${percentage}% • ${app.correct_answers || 0} correct • ${app.wrong_answers || 0} wrong</div>
            </div>
            
            <button class="details-toggle" onclick="toggleAnswers(${app.id})">
              <i class="fas fa-chevron-down"></i> View Test Details
            </button>
            
            <div class="answers-content" id="answers-${app.id}">
              <strong>Full Test Transcript:</strong><br><br>
      `;
      
      if (testResults.transcript) {
        html += testResults.transcript.replace(/\n/g, '<br>');
      } else if (typeof app.answers === 'string') {
        try {
          const answers = JSON.parse(app.answers);
          html += JSON.stringify(answers, null, 2).replace(/\n/g, '<br>');
        } catch (e) {
          html += app.answers.replace(/\n/g, '<br>');
        }
      }
      
      html += `
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
  req.session.destroy();
  res.redirect("https://hunterahead71-hash.github.io/void.training/");
});

/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    session: req.session.user ? "active" : "none",
    bot: bot.user ? "connected" : "disconnected"
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend URL: https://hunterahead71-hash.github.io/void.training/`);
  console.log(`Admin login: https://mod-application-backend.onrender.com/auth/discord`);
  console.log(`Health check: https://mod-application-backend.onrender.com/health`);
});
