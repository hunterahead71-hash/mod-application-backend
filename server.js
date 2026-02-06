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

// IMPORTANT: CORS must allow credentials
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
);

app.use(express.json());

// IMPORTANT: session config for Render / cross-site cookies
app.use(
  session({
    name: "mod-app-session",
    secret: "super-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,          // Render uses HTTPS
      sameSite: "none"       // REQUIRED for cross-domain cookies
    }
  })
);

/* ================= DISCORD BOT ================= */

const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

bot.login(process.env.DISCORD_BOT_TOKEN);

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

    const adminIds = process.env.ADMIN_IDS.split(",");

    if (adminIds.includes(userRes.data.id)) {
      // Admin
      return res.redirect("/admin");
    }

    // Normal user
    return res.redirect(process.env.FRONTEND_URL);

  } catch (err) {
    console.error("Discord auth error:", err);
    res.status(500).send("Discord authentication failed");
  }
});

/* ================= AUTH CHECK (FOR FRONTEND) ================= */

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

  const { answers, score } = req.body;

  try {
    const { error } = await supabase.from("applications").insert({
      discord_id: req.session.user.id,
      discord_username: req.session.user.username,
      answers,
      score,
      status: "pending"
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Apply error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= ADMIN ================= */

app.get("/admin", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send("Not logged in");
  }

  const adminIds = process.env.ADMIN_IDS.split(",");
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
    <h1>Admin Dashboard</h1>
    <p>Total Applications: ${data.length}</p>
    <hr/>
  `;

  if (data.length === 0) {
    html += `<p>No applications yet.</p>`;
  }

  data.forEach(app => {
    html += `
      <div style="border:1px solid #ccc;padding:15px;margin:15px">
        <b>Discord Username:</b> ${app.discord_username}<br/>
        <b>Discord ID:</b> ${app.discord_id}<br/>
        <b>Score:</b> ${app.score}<br/>
        <b>Status:</b> ${app.status}<br/>

        <details>
          <summary>View Answers</summary>
          <pre>${JSON.stringify(app.answers, null, 2)}</pre>
        </details>

        ${
          app.status === "pending"
            ? `
              <form method="POST" action="/admin/accept/${app.id}" style="display:inline">
                <button type="submit">✅ Accept</button>
              </form>

              <form method="POST" action="/admin/reject/${app.id}" style="display:inline">
                <button type="submit">❌ Reject</button>
              </form>
            `
            : ""
        }
      </div>
    `;
  });

  res.send(html);
});

app.post("/admin/accept/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).send("Application not found");
    }

    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(data.discord_id);

    await member.roles.add(process.env.MOD_ROLE_ID);

    await supabase
      .from("applications")
      .update({ status: "accepted" })
      .eq("id", id);

    res.redirect("/admin");
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).send("Failed to assign role");
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  const id = req.params.id;

  await supabase
    .from("applications")
    .update({ status: "rejected" })
    .eq("id", id);

  res.redirect("/admin");
});

/* ================= TEST ================= */

app.get("/__test", (req, res) => {
  res.send("SERVER ROUTES ARE ACTIVE");
});

/* ================= START ================= */

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
