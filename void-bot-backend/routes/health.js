const express = require("express");
const axios = require("axios");
const { supabase } = require("../config/supabase");
const { logger } = require("../utils/logger");

const router = express.Router();

// Health check - FIXED to not depend on session
router.get("/health", async (req, res) => {
  try {
    // Test database connection
    const { error } = await supabase
      .from("applications")
      .select("count", { count: 'exact', head: true });
    
    const dbStatus = error ? `ERROR: ${error.message}` : "✅ CONNECTED";
    
    // Check bot status safely
    const { getBot } = require("../config/discord");
    const bot = getBot();
    const botStatus = bot && bot.user ? `✅ CONNECTED as ${bot.user.tag}` : "❌ DISCONNECTED";
    
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      discordBot: botStatus,
      discordWebhook: process.env.DISCORD_WEBHOOK_URL ? "✅ CONFIGURED" : "❌ NOT CONFIGURED",
      discordGuild: process.env.DISCORD_GUILD_ID ? "✅ CONFIGURED" : "❌ NOT CONFIGURED",
      modRole: process.env.MOD_ROLE_ID ? "✅ CONFIGURED" : "❌ NOT CONFIGURED",
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        hasSessionSecret: !!process.env.SESSION_SECRET
      },
      endpoints: {
        submit: "/api/submit",
        submitTestResults: "/submit-test-results",
        admin: "/admin",
        auth: "/auth/discord",
        startTest: "/api/start-test"
      }
    });
  } catch (err) {
    res.status(200).json({ 
      status: "degraded", 
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
