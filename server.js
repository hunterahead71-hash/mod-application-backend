const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { Client, GatewayIntentBits } = require("discord.js");

const app = express();
app.use(cors());
app.use(express.json());

app.use(
  session({
    secret: "super-secret-key",
    resave: false,
    saveUninitialized: false
  })
);

// Discord bot
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

bot.login(process.env.DISCORD_BOT_TOKEN);


/* ================= DISCORD AUTH ================= */

app.get("/auth/discord", (req, res) => {
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;
  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;

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

  const userRes = await axios.get("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
  });

  req.session.user = userRes.data;

  const adminIds = process.env.ADMIN_IDS.split(",");

  if (adminIds.includes(userRes.data.id)) {
  // Admin → go to admin dashboard
    res.redirect("/admin");
  } else {
  // Normal user → go to website
    res.redirect(process.env.FRONTEND_URL);
  }

});

/* ================= APPLICATION ================= */

app.post("/apply", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { answers, score } = req.body;

  const { error } = await supabase.from("applications").insert({
    discord_id: req.session.user.id,
    discord_username: req.session.user.username,
    answers,
    score,
    status: "pending"
  });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Database error" });
  }

  res.json({ success: true });
});


/* ================= ADMIN ================= */

app.post("/admin/accept/:id", async (req, res) => {
  const id = req.params.id;

  // 1. Get application from Supabase
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error(error);
    return res.status(404).send("Application not found");
  }

  // 2. Give Discord role
  const guild = await bot.guilds.fetch(process.env.GUILD_ID);
  const member = await guild.members.fetch(data.discord_id);
  await member.roles.add(process.env.MOD_ROLE_ID);

  // 3. Update status in DB
  await supabase
    .from("applications")
    .update({ status: "accepted" })
    .eq("id", id);

  // 4. Go back to admin page
  res.redirect("/admin");
});
app.post("/admin/reject/:id", async (req, res) => {
  const id = req.params.id;

  await supabase
    .from("applications")
    .update({ status: "rejected" })
    .eq("id", id);

  res.redirect("/admin");
});
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



/* ================= START ================= */
app.get("/__test", (req, res) => {
  res.send("SERVER ROUTES ARE ACTIVE");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
