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

// In-memory storage (FREE & simple)
const applications = [];

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

app.get("/admin", (req, res) => {
  if (!process.env.ADMIN_IDS.split(",").includes(req.session.user?.id)) {
    return res.status(403).send("Forbidden");
  }
  res.json(applications);
});

app.post("/admin/accept/:id", async (req, res) => {
  const appId = Number(req.params.id);
  const application = applications.find(a => a.id === appId);

  if (!application) return res.sendStatus(404);

  const guild = await bot.guilds.fetch(process.env.GUILD_ID);
  const member = await guild.members.fetch(application.user.id);
  await member.roles.add(process.env.MOD_ROLE_ID);

  application.status = "accepted";
  res.json({ success: true });
});

app.post("/admin/reject/:id", (req, res) => {
  const appId = Number(req.params.id);
  const application = applications.find(a => a.id === appId);

  if (!application) return res.sendStatus(404);

  application.status = "rejected";
  res.json({ success: true });
});

/* ================= START ================= */

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
