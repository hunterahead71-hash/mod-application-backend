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

/* ================= MIDDLEWARE ================= */

// IMPORTANT: CORS must allow credentials for GitHub Pages
app.use(
  cors({
    origin: "https://hunterahead71-hash.github.io",
    credentials: true
  })
);

app.use(express.json());

// IMPORTANT: session config for cross-site cookies
app.use(
  session({
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "super-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
      domain: "hunterahead71-hash.github.io"
    }
  })
);

/* ================= DISCORD BOT ================= */

const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

bot.login(process.env.DISCORD_BOT_TOKEN).catch(console.error);

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
    req.session.save();

    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];

    if (adminIds.includes(userRes.data.id)) {
      return res.redirect("/admin");
    }

    // Check if user came from "take test" button
    if (req.session.testIntent === "test") {
      req.session.testIntent = false;
      req.session.save();
      
      // Redirect to GitHub Pages with test flag
      return res.redirect(`https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}`);
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
    user: req.session.user
  });
});

/* ================= APPLICATION ================= */

app.post("/apply", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { answers, score, discordUsername } = req.body;

  try {
    const { error } = await supabase.from("applications").insert({
      discord_id: req.session.user.id,
      discord_username: discordUsername || req.session.user.username,
      answers: typeof answers === 'string' ? answers : JSON.stringify(answers),
      score: score,
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
    return res.status(401).send("Not logged in");
  }

  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  if (!adminIds.includes(req.session.user.id)) {
    return res.status(403).send("Forbidden");
  }

  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).send("Database error");
  }

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Void Esports - Admin Dashboard</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 40px;
          background: #1a1a1a;
          color: white;
        }
        h1 {
          color: #ff0033;
          border-bottom: 2px solid #ff0033;
          padding-bottom: 10px;
        }
        .app-card {
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 10px;
          padding: 20px;
          margin: 20px 0;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .app-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }
        .app-status {
          padding: 5px 15px;
          border-radius: 20px;
          font-weight: bold;
        }
        .status-pending {
          background: #ff9900;
          color: black;
        }
        .status-accepted {
          background: #00cc00;
          color: white;
        }
        .status-rejected {
          background: #cc0000;
          color: white;
        }
        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: bold;
          margin-right: 10px;
          text-decoration: none;
          display: inline-block;
        }
        .btn-accept {
          background: #00cc00;
          color: white;
        }
        .btn-reject {
          background: #cc0000;
          color: white;
        }
        .answers {
          background: #333;
          padding: 15px;
          border-radius: 5px;
          margin-top: 15px;
          white-space: pre-wrap;
          font-family: monospace;
          max-height: 300px;
          overflow-y: auto;
        }
        .filters {
          margin: 20px 0;
          padding: 15px;
          background: #2a2a2a;
          border-radius: 10px;
        }
        .filter-btn {
          background: #444;
          color: white;
          padding: 8px 16px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          margin-right: 10px;
        }
        .filter-btn.active {
          background: #ff0033;
        }
        .logout-btn {
          position: absolute;
          top: 20px;
          right: 20px;
          background: #666;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          text-decoration: none;
        }
        .details {
          background: #333;
          padding: 15px;
          border-radius: 5px;
          margin-top: 15px;
        }
      </style>
    </head>
    <body>
      <a href="/logout" class="logout-btn">Logout</a>
      <h1>Void Esports Admin Dashboard</h1>
      <p>Logged in as: ${req.session.user.username}#${req.session.user.discriminator}</p>
      <p>Total Applications: ${data.length}</p>
      
      <div class="filters">
        <button class="filter-btn active" onclick="filterApplications('all')">All (${data.length})</button>
        <button class="filter-btn" onclick="filterApplications('pending')">Pending (${data.filter(a => a.status === 'pending').length})</button>
        <button class="filter-btn" onclick="filterApplications('accepted')">Accepted (${data.filter(a => a.status === 'accepted').length})</button>
        <button class="filter-btn" onclick="filterApplications('rejected')">Rejected (${data.filter(a => a.status === 'rejected').length})</button>
      </div>
      <hr/>
  `;

  if (data.length === 0) {
    html += `<p>No applications yet.</p>`;
  }

  data.forEach(app => {
    const statusClass = `status-${app.status}`;
    const answersText = typeof app.answers === 'string' ? app.answers : JSON.stringify(app.answers, null, 2);
    const truncatedAnswers = answersText.length > 500 ? answersText.substring(0, 500) + '...' : answersText;
    
    html += `
      <div class="app-card" data-status="${app.status}">
        <div class="app-header">
          <div>
            <h3>${app.discord_username} (ID: ${app.discord_id})</h3>
            <p>Submitted: ${new Date(app.created_at).toLocaleString()}</p>
          </div>
          <div class="app-status ${statusClass}">
            ${app.status.toUpperCase()}
          </div>
        </div>
        
        <div>
          <strong>Score:</strong> ${app.score}<br>
          
          <details>
            <summary><strong>View Answers/Transcript</strong></summary>
            <div class="answers">${truncatedAnswers}</div>
            ${answersText.length > 500 ? '<p><em>Answer truncated. Full answer stored in database.</em></p>' : ''}
          </details>
          
          <div style="margin-top: 15px;">
    `;
    
    if (app.status === "pending") {
      html += `
              <form method="POST" action="/admin/accept/${app.id}" style="display:inline">
                <button type="submit" class="btn btn-accept">✅ Accept & Grant Mod Role</button>
              </form>
              <form method="POST" action="/admin/reject/${app.id}" style="display:inline">
                <button type="submit" class="btn btn-reject">❌ Reject</button>
              </form>
      `;
    } else if (app.status === "accepted") {
      html += `<p><em>✅ Accepted on ${new Date(app.updated_at || app.created_at).toLocaleString()}</em></p>`;
    } else if (app.status === "rejected") {
      html += `<p><em>❌ Rejected on ${new Date(app.updated_at || app.created_at).toLocaleString()}</em></p>`;
    }
    
    html += `
          </div>
        </div>
      </div>
    `;
  });

  html += `
      <script>
        function filterApplications(status) {
          const cards = document.querySelectorAll('.app-card');
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
      </script>
    </body>
    </html>
  `;

  res.send(html);
});

app.post("/admin/accept/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!req.session.user) {
      return res.status(401).send("Not logged in");
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
      return res.status(403).send("Forbidden");
    }

    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("Application not found:", error);
      return res.status(404).send("Application not found");
    }

    // Assign mod role using Discord bot
    try {
      const guild = await bot.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(data.discord_id);
      await member.roles.add(process.env.MOD_ROLE_ID);
      
      console.log(`Assigned mod role to ${data.discord_username} (${data.discord_id})`);
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

    res.redirect("/admin");
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).send("Failed to process acceptance");
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!req.session.user) {
      return res.status(401).send("Not logged in");
    }
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (!adminIds.includes(req.session.user.id)) {
      return res.status(403).send("Forbidden");
    }

    await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    res.redirect("/admin");
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).send("Failed to process rejection");
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
    session: req.session.user ? "active" : "none"
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend URL: https://hunterahead71-hash.github.io/void.training/`);
  console.log(`Admin login: https://mod-application-backend.onrender.com/auth/discord`);
});
