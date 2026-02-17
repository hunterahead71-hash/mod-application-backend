const { logger } = require("../utils/logger");

// Check if user is authenticated
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ 
      success: false, 
      error: "Not authenticated" 
    });
  }
  next();
}

// Check if user is admin
function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.isAdmin) {
    logger.warn(`Unauthorized admin access attempt by ${req.session.user?.username || 'unknown'}`);
    return res.status(401).json({ 
      success: false, 
      error: "Admin access required" 
    });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
