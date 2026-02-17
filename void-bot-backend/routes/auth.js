const express = require("express");
const axios = require("axios");
const { logger } = require("../utils/logger");
const { checkAuthRateLimit, authRateLimiter } = require("../utils/helpers");
const { isTestUser } = require("../utils/helpers");

const router = express.Router();

// Store intents in memory
const pendingIntents = new Map();

// Test intent endpoints
router.get("/set-test-intent", (req, res) => {
  logger.info("Setting test intent...");
  req.session.loginIntent = "test";
  pendingIntents.set(req.sessionID, {
    intent: "test",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      logger.error("Session save error:", err);
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

router.get("/set-admin-intent", (req, res) => {
  logger.info("Setting admin intent...");
  req.session.loginIntent = "admin";
  pendingIntents.set(req.sessionID, {
    intent: "admin",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      logger.error("Session save error:", err);
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

// Discord auth routes
router.get("/discord", checkAuthRateLimit, (req, res) => {
  logger.info("Discord auth initiated for TEST");
  
  if (!req.session.loginIntent) {
    req.session.loginIntent = "test";
  }
  
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

router.get("/discord/admin", checkAuthRateLimit, (req, res) => {
  logger.info("Discord auth initiated for ADMIN");
  
  req.session.loginIntent = "admin";
  
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

router.get("/discord/callback", checkAuthRateLimit, async (req, res) => {
  try {
    logger.info("\n=== DISCORD CALLBACK START ===");
    
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

    // Track auth attempts
    const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
    const key = `auth_${ip}`;
    const now = Date.now();
    
    if (authRateLimiter.has(key)) {
      const data = authRateLimiter.get(key);
      data.count += 1;
      data.timestamp = now;
    } else {
      authRateLimiter.set(key, { count: 1, timestamp: now });
    }

    // Get Discord token
    let tokenRes;
    try {
      tokenRes = await axios.post(
        "https://discord.com/api/oauth2/token",
        new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: process.env.REDIRECT_URI
        }),
        { 
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10000
        }
      );
    } catch (error) {
      logger.error("Discord token request failed:", error.message);
      
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 60;
        return res.status(429).send(`
          <!DOCTYPE html>
          <html>
          <head>
              <title>Rate Limited by Discord</title>
              <style>
                  body { font-family: Arial; text-align: center; padding: 50px; background: #36393f; color: white; }
                  h1 { color: #ff0033; }
                  .info { background: #202225; padding: 30px; border-radius: 12px; margin: 30px auto; max-width: 600px; }
              </style>
          </head>
          <body>
              <h1>⚠️ Rate Limited by Discord</h1>
              <div class="info">
                  <p>Too many authentication attempts. Please wait ${retryAfter} seconds before trying again.</p>
                  <p><a href="https://hunterahead71-hash.github.io/void.training/" style="color: #00ffea;">Return to Training</a></p>
              </div>
          </body>
          </html>
        `);
      }
      
      throw error;
    }

    // Get user info
    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
        timeout: 10000
      }
    );

    logger.info("Discord user authenticated:", userRes.data.username);

    // Save user in session
    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    // Check if admin
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
      logger.info("User is admin:", userRes.data.username);
    }
    
    // Check intent from session or memory backup
    let intent = req.session.loginIntent;
    if (!intent && pendingIntents.has(req.sessionID)) {
      intent = pendingIntents.get(req.sessionID).intent;
      req.session.loginIntent = intent;
    }
    
    // Clean up memory backup
    pendingIntents.delete(req.sessionID);
    
    // Save session
    req.session.save((err) => {
      if (err) {
        logger.error("Session save error:", err);
        return res.status(500).send("Session error");
      }
      
      // FOR ADMINS WITH ADMIN INTENT
      if (req.session.isAdmin && intent === "admin") {
        logger.info("Redirecting admin to /admin");
        req.session.loginIntent = null;
        req.session.save(() => res.redirect("/admin"));
        return;
      }
      
      // FOR REGULAR USERS WHO ACCIDENTALLY CLICKED ADMIN LOGIN
      if (intent === "admin" && !req.session.isAdmin) {
        logger.info("Non-admin trying to access admin panel");
        req.session.loginIntent = null;
        req.session.save(() => {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Access Denied</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #36393f; color: white; }
                    h1 { color: #ff0033; }
                    .container { background: #202225; padding: 40px; border-radius: 12px; margin: 30px auto; max-width: 600px; }
                    .btn { display: inline-block; margin: 10px; padding: 12px 24px; background: #5865f2; color: white; text-decoration: none; border-radius: 8px; }
                </style>
            </head>
            <body>
                <h1>❌ Access Denied</h1>
                <div class="container">
                    <p>You don't have administrator privileges.</p>
                    <p>Your Discord: ${req.session.user.username}#${req.session.user.discriminator}</p>
                    <p>Your ID: ${req.session.user.id}</p>
                    <a href="https://hunterahead71-hash.github.io/void.training/" class="btn">Return to Training</a>
                    <a href="/auth/discord" class="btn">Take Mod Test Instead</a>
                </div>
            </body>
            </html>
          `);
        });
        return;
      }
      
      // FOR REGULAR USERS WITH TEST INTENT
      if (intent === "test") {
        logger.info("User has test intent, redirecting to test interface");
        req.session.loginIntent = null;
        
        req.session.save(() => {
          const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}&timestamp=${Date.now()}`;
          res.redirect(frontendUrl);
        });
        return;
      }
      
      // DEFAULT: Redirect to homepage
      res.redirect("https://hunterahead71-hash.github.io/void.training/");
    });

  } catch (err) {
    logger.error("Discord auth error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Auth Error</title></head>
      <body>
        <h1>Authentication Failed</h1>
        <p>${err.message}</p>
        <p><a href="/auth/discord">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

// Fallback login
router.get("/fallback-login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Alternative Login</title>
        <style>
            body { font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(135deg, #0f0f23, #1a1a2e); color: white; }
            .login-box { background: rgba(32, 34, 37, 0.9); padding: 40px; border-radius: 20px; margin: 30px auto; max-width: 500px; }
            input { width: 100%; padding: 12px; margin: 10px 0; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; }
            button { background: #5865f2; color: white; border: none; padding: 15px 30px; border-radius: 8px; font-size: 18px; cursor: pointer; width: 100%; }
        </style>
    </head>
    <body>
        <h1>Alternative Login Method</h1>
        <div class="login-box">
            <form id="fallbackForm">
                <input type="text" id="discordUsername" placeholder="Discord Username" required>
                <input type="text" id="discordId" placeholder="Discord ID (numeric)" pattern="\\d+" required>
                <button type="submit">Continue to Test</button>
            </form>
            <p><a href="/auth/discord" style="color: #00ffea;">Try Discord OAuth again</a></p>
        </div>
        <script>
            document.getElementById('fallbackForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const username = document.getElementById('discordUsername').value;
                const id = document.getElementById('discordId').value;
                window.location.href = \`https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=\${encodeURIComponent(username)}&discord_id=\${id}&manual_login=true\`;
            });
        </script>
    </body>
    </html>
  `);
});

// Get current user
router.get("/me", (req, res) => {
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

module.exports = router;
