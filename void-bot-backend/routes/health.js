const express = require("express");
const { supabase } = require("../config/supabase");
const { bot } = require("../config/discord");
const { logger } = require("../utils/logger");

const router = express.Router();

// Health check
router.get("/health", async (req, res) => {
  try {
    const { error } = await supabase
      .from("applications")
      .select("count", { count: 'exact', head: true });
    
    const dbStatus = error ? `ERROR: ${error.message}` : "CONNECTED";
    const botStatus = bot.user ? `CONNECTED as ${bot.user.tag}` : "DISCONNECTED";
    
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      discordBot: botStatus,
      discordWebhook: process.env.DISCORD_WEBHOOK_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      discordGuild: process.env.DISCORD_GUILD_ID ? "CONFIGURED" : "NOT_CONFIGURED",
      modRole: process.env.MOD_ROLE_ID ? "CONFIGURED" : "NOT_CONFIGURED",
      session: req.session.user ? "active" : "none",
      endpoints: {
        submit: "/api/submit",
        submitTestResults: "/submit-test-results",
        admin: "/admin",
        auth: "/auth/discord"
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Discord API status
router.get("/api/discord-status", async (req, res) => {
  try {
    const response = await axios.get("https://discordstatus.com/api/v2/status.json", {
      timeout: 5000
    });
    
    res.json({
      success: true,
      discord_api: response.data.status.indicator === "none" ? "operational" : "issues",
      description: response.data.status.description,
      indicator: response.data.status.indicator,
      timestamp: new Date().toISOString(),
      rate_limit_info: {
        message: "If you're getting 429 errors, wait 60 seconds between auth attempts",
        retry_after: 60,
        max_attempts_per_hour: 10
      }
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Session debug
router.get("/debug-session", (req, res) => {
  res.json({
    sessionId: req.sessionID,
    user: req.session.user || 'No user',
    isAdmin: req.session.isAdmin || false,
    loginIntent: req.session.loginIntent || 'No intent',
    cookies: req.headers.cookie || 'No cookies'
  });
});

module.exports = router;
