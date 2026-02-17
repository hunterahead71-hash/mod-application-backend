const { logger } = require("./logger");

// Function to escape HTML for safety
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Check if user is a test user
function isTestUser(discordUsername, discordId) {
  const username = discordUsername.toLowerCase();
  const id = discordId.toString();
  
  return username.includes('test') || 
         username.includes('bot') ||
         id.includes('test') ||
         id === '0000' ||
         username === 'user' ||
         username.includes('example') ||
         id.length < 5 ||
         username.startsWith('test_') ||
         id.startsWith('test_') ||
         username.includes('demo') ||
         id === '123456789' ||
         username.includes('fake') ||
         username.includes('dummy');
}

// Rate limiting for auth
const authRateLimiter = new Map();

function checkAuthRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
  const key = `auth_${ip}`;
  
  if (authRateLimiter.has(key)) {
    const data = authRateLimiter.get(key);
    const now = Date.now();
    
    if (data.count >= 10 && now - data.timestamp < 3600000) {
      logger.info(`Rate limited IP: ${ip} - too many auth attempts`);
      return res.status(429).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Rate Limited</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #36393f; color: white; }
                h1 { color: #ff0033; }
                .retry-time { background: #202225; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 400px; }
            </style>
        </head>
        <body>
            <h1>⚠️ Rate Limited</h1>
            <p>Too many authentication attempts from your IP address.</p>
            <div class="retry-time">
                <p>Please wait at least 1 hour before trying again.</p>
                <p>This is a Discord API restriction to prevent abuse.</p>
            </div>
            <p><a href="https://hunterahead71-hash.github.io/void.training/" style="color: #00ffea; text-decoration: none;">Return to Training Page</a></p>
        </body>
        </html>
      `);
    }
  }
  
  next();
}

// Clean up rate limiter every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of authRateLimiter.entries()) {
    if (now - data.timestamp > 3600000) {
      authRateLimiter.delete(key);
    }
  }
}, 600000);

module.exports = { 
  escapeHtml, 
  isTestUser, 
  checkAuthRateLimit,
  authRateLimiter
};
