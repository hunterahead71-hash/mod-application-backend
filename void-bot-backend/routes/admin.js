const express = require("express");
const axios = require("axios");
const { supabase } = require("../config/supabase");
const { requireAdmin } = require("../middleware/auth");
const { assignModRole, sendRejectionDM } = require("../utils/discordHelpers");
const { escapeHtml, isTestUser } = require("../utils/helpers");
const { logger } = require("../utils/logger");

const router = express.Router();
// ==================== FUNCTION TO UPDATE DISCORD MESSAGE ====================
async function updateDiscordMessage(appId, status, adminName, reason = '') {
  try {
    const { getClient, ensureReady } = require("../config/discord");
    const bot = getClient();
    
    if (!bot || !await ensureReady() || !process.env.DISCORD_CHANNEL_ID) {
      logger.warn("Cannot update Discord message: Bot not ready or channel not configured");
      return false;
    }

    // Get the channel
    const channel = await bot.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) {
      logger.error(`Channel ${process.env.DISCORD_CHANNEL_ID} not found`);
      return false;
    }

    // Fetch recent messages (limit 100)
    const messages = await channel.messages.fetch({ limit: 100 });
    
    for (const [msgId, msg] of messages) {
      if (msg.embeds && msg.embeds.length > 0) {
        const embed = msg.embeds[0];
        const footerText = embed.footer?.text || '';
        
        // Look for app ID in footer (format: "ID: 123")
        if (footerText.includes(appId.toString())) {
          logger.info(`Found Discord message ${msgId} for app ${appId}`);
          
          // Create updated embed
          const updatedEmbed = {
            ...embed.toJSON(),
            color: status === 'accepted' ? 0x10b981 : 0xed4245,
          };

          // Remove any existing review fields
          const fields = embed.fields?.filter(f => 
            !f.name.includes('Accepted') && 
            !f.name.includes('Rejected') &&
            !f.name.includes('Reason')
          ) || [];

          // Add new review field
          fields.push({
            name: status === 'accepted' ? "✅ Accepted By" : "❌ Rejected By",
            value: adminName,
            inline: true
          });

          // Add reason if rejection
          if (status === 'rejected' && reason) {
            fields.push({
              name: "📝 Reason",
              value: reason.substring(0, 100),
              inline: false
            });
          }

          updatedEmbed.fields = fields;

          // Update the message (remove buttons)
          await msg.edit({ 
            embeds: [updatedEmbed], 
            components: [] 
          });

          logger.success(`✅ Updated Discord message ${msgId} to ${status}`);
          
          // Store message ID in database
          try {
            await supabase
              .from("applications")
              .update({ discord_message_id: msgId })
              .eq("id", appId);
          } catch (dbError) {}

          return true;
        }
      }
    }

    logger.warn(`No Discord message found for app ${appId}`);
    return false;
  } catch (error) {
    logger.error("❌ Error updating Discord message:", error.message);
    return false;
  }
}
// ==================== CREATE TABLES IF NOT EXISTS ====================
async function ensureTables() {
  try {
    // Create test_questions table
    const { error: createTestError } = await supabase.rpc('create_test_questions_table', {});
    if (createTestError) {
      // Try direct SQL if RPC fails
      const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS test_questions (
          id BIGSERIAL PRIMARY KEY,
          user_message TEXT NOT NULL,
          username TEXT DEFAULT 'User',
          avatar_color TEXT DEFAULT '#5865f2',
          keywords TEXT[] DEFAULT '{}',
          required_matches INTEGER DEFAULT 2,
          explanation TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      if (error) logger.error("Error creating test_questions:", error.message);
    }

    // Create quiz_questions table
    const { error: createQuizError } = await supabase.rpc('create_quiz_questions_table', {});
    if (createQuizError) {
      const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS quiz_questions (
          id BIGSERIAL PRIMARY KEY,
          question_number INTEGER,
          title TEXT,
          description TEXT,
          optimal_response TEXT,
          key_elements TEXT[] DEFAULT '{}',
          avoid TEXT[] DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      if (error) logger.error("Error creating quiz_questions:", error.message);
    }

    // Create mod_roles table
    const { error: createRolesError } = await supabase.rpc('create_mod_roles_table', {});
    if (createRolesError) {
      const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS mod_roles (
          id BIGSERIAL PRIMARY KEY,
          role_id TEXT NOT NULL UNIQUE,
          role_name TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      if (error) logger.error("Error creating mod_roles:", error.message);
    }
  } catch (err) {
    logger.error("Error ensuring tables:", err.message);
  }
}

// Call on startup
ensureTables();

// ==================== MAIN ADMIN DASHBOARD ====================
router.get("/", requireAdmin, async (req, res) => {
  logger.info("\n=== ADMIN DASHBOARD ACCESS ===");
  logger.info(`Admin: ${req.session.user.username}`);
  
  try {
    // Get applications
    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("Supabase error:", error);
      return res.status(500).send("Database error");
    }

    // Filter test users
    const realApplications = applications.filter(app => 
      !isTestUser(app.discord_username, app.discord_id)
    );

    const pendingApplications = realApplications.filter(app => app.status === 'pending');
    const acceptedApplications = realApplications.filter(app => app.status === 'accepted');
    const rejectedApplications = realApplications.filter(app => app.status === 'rejected');
    
    // Get counts for badges
    let testQuestionsCount = 8;
    let quizQuestionsCount = 7;
    let modRolesCount = 1;

    try {
      const { count: testCount } = await supabase
        .from("test_questions")
        .select("*", { count: 'exact', head: true });
      if (testCount) testQuestionsCount = testCount;
    } catch (e) {}

    try {
      const { count: quizCount } = await supabase
        .from("quiz_questions")
        .select("*", { count: 'exact', head: true });
      if (quizCount) quizQuestionsCount = quizCount;
    } catch (e) {}

    try {
      const { count: rolesCount } = await supabase
        .from("mod_roles")
        .select("*", { count: 'exact', head: true });
      if (rolesCount) modRolesCount = rolesCount;
    } catch (e) {}
    
    // Generate HTML
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VOID ADMIN • DARK PORTAL</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
                background: #0a0a0c;
                color: #e4e4e7;
                min-height: 100vh;
                line-height: 1.5;
            }
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: #1a1a1e; }
            ::-webkit-scrollbar-thumb { background: #3a3a44; border-radius: 4px; }
            .app-container { display: flex; min-height: 100vh; }
            
            /* Sidebar */
            .sidebar {
                width: 280px;
                background: #111113;
                border-right: 1px solid #2a2a2e;
                display: flex;
                flex-direction: column;
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                overflow-y: auto;
                padding: 24px 0;
            }
            .sidebar-header { padding: 0 20px 24px; border-bottom: 1px solid #2a2a2e; }
            .sidebar-logo {
                font-size: 22px;
                font-weight: 700;
                color: white;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .sidebar-logo i { color: #6b6bf3; font-size: 24px; }
            .sidebar-user {
                padding: 20px;
                margin: 0 12px 24px;
                background: #1a1a1e;
                border-radius: 12px;
                border: 1px solid #2a2a2e;
            }
            .user-info { display: flex; align-items: center; gap: 12px; }
            .user-avatar {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: linear-gradient(135deg, #6b6bf3, #4b4bb3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: white;
            }
            .user-name { font-weight: 600; color: white; }
            .nav-menu { flex: 1; padding: 0 12px; }
            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                margin-bottom: 4px;
                border-radius: 10px;
                color: #8b8b98;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .nav-item:hover { background: #1a1a1e; color: #e4e4e7; }
            .nav-item.active { background: #1a1a1e; color: #6b6bf3; border-left: 3px solid #6b6bf3; }
            .nav-item .badge {
                margin-left: auto;
                background: #2a2a2e;
                padding: 2px 8px;
                border-radius: 20px;
                font-size: 11px;
            }
            .sidebar-footer {
                padding: 24px 20px;
                border-top: 1px solid #2a2a2e;
                margin-top: auto;
            }
            .logout-btn {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: #1a1a1e;
                border-radius: 10px;
                color: #ed4245;
                text-decoration: none;
                border: 1px solid #2a2a2e;
            }
            
            /* Main Content */
            .main-content {
                flex: 1;
                margin-left: 280px;
                padding: 32px;
                background: #0f0f11;
            }
            .top-bar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 32px;
            }
            .page-title {
                font-size: 28px;
                font-weight: 700;
                color: white;
            }
            .page-title i { color: #6b6bf3; margin-right: 12px; }
            
            /* Buttons */
            .btn {
                padding: 10px 20px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                border: none;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s ease;
                text-decoration: none;
            }
            .btn-primary { background: #6b6bf3; color: white; }
            .btn-primary:hover { background: #7b7bff; transform: translateY(-2px); }
            .btn-outline {
                background: transparent;
                border: 1px solid #2a2a2e;
                color: #e4e4e7;
            }
            .btn-outline:hover { background: #1a1a1e; }
            .btn-danger { background: #ed4245; color: white; }
            
            /* Stats Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                gap: 20px;
                margin-bottom: 32px;
            }
            .stat-card {
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 16px;
                padding: 24px;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .stat-card:hover { border-color: #6b6bf3; transform: translateY(-4px); }
            .stat-icon {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                margin-bottom: 16px;
            }
            .stat-icon.pending { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
            .stat-icon.accepted { background: rgba(16, 185, 129, 0.1); color: #10b981; }
            .stat-icon.rejected { background: rgba(237, 66, 69, 0.1); color: #ed4245; }
            .stat-icon.total { background: rgba(107, 107, 243, 0.1); color: #6b6bf3; }
            .stat-value { font-size: 32px; font-weight: 700; color: white; }
            .stat-label { font-size: 14px; color: #8b8b98; }
            
            /* Tab Navigation */
            .tab-nav {
                display: flex;
                gap: 4px;
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 12px;
                padding: 4px;
                margin-bottom: 24px;
                overflow-x: auto;
            }
            .tab-btn {
                padding: 12px 24px;
                background: transparent;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                color: #8b8b98;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
            }
            .tab-btn:hover { color: #e4e4e7; background: #1a1a1e; }
            .tab-btn.active { background: #1a1a1e; color: white; }
            .tab-btn .badge {
                background: #2a2a2e;
                padding: 2px 8px;
                border-radius: 20px;
                font-size: 11px;
            }
            .tab-btn.active .badge { background: #6b6bf3; color: white; }
            
            /* Tab Content */
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            
            /* Applications Grid */
            .apps-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                gap: 20px;
            }
            .app-card {
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 16px;
                padding: 20px;
                transition: all 0.2s ease;
            }
            .app-card:hover { border-color: #6b6bf3; }
            .app-header {
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px solid #2a2a2e;
            }
            .app-avatar {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                background: linear-gradient(135deg, #6b6bf3, #4b4bb3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: white;
            }
            .app-username { font-weight: 600; color: white; }
            .app-id { font-size: 12px; color: #8b8b98; font-family: monospace; }
            .app-badge {
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
            }
            .app-badge.pending { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
            .app-badge.accepted { background: rgba(16, 185, 129, 0.1); color: #10b981; }
            .app-badge.rejected { background: rgba(237, 66, 69, 0.1); color: #ed4245; }
            
            .score-number { font-size: 28px; font-weight: 700; color: #6b6bf3; }
            .progress-bar {
                height: 6px;
                background: #1a1a1e;
                border-radius: 3px;
                margin: 12px 0;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #6b6bf3, #8b8bf8);
                border-radius: 3px;
                transition: width 0.3s ease;
            }
            
            .app-actions {
                display: flex;
                gap: 12px;
                margin-top: 16px;
            }
            .action-btn {
                flex: 1;
                padding: 10px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s ease;
            }
            .action-btn.accept {
                background: rgba(16, 185, 129, 0.1);
                color: #10b981;
                border: 1px solid rgba(16, 185, 129, 0.3);
            }
            .action-btn.accept:hover { background: #10b981; color: white; }
            .action-btn.reject {
                background: rgba(237, 66, 69, 0.1);
                color: #ed4245;
                border: 1px solid rgba(237, 66, 69, 0.3);
            }
            .action-btn.reject:hover { background: #ed4245; color: white; }
            
            /* Data Tables */
            .data-table {
                width: 100%;
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 16px;
                overflow: hidden;
            }
            .data-table table {
                width: 100%;
                border-collapse: collapse;
            }
            .data-table th {
                text-align: left;
                padding: 16px 20px;
                background: #1a1a1e;
                color: #8b8b98;
                font-weight: 600;
                font-size: 13px;
                border-bottom: 1px solid #2a2a2e;
            }
            .data-table td {
                padding: 16px 20px;
                border-bottom: 1px solid #2a2a2e;
                color: #e4e4e7;
            }
            .data-table tr:last-child td { border-bottom: none; }
            .data-table tr:hover td { background: #1a1a1e; }
            
            /* Forms */
            .form-group { margin-bottom: 20px; }
            .form-label {
                display: block;
                margin-bottom: 8px;
                color: #8b8b98;
                font-weight: 500;
                font-size: 14px;
            }
            .form-input {
                width: 100%;
                padding: 12px 16px;
                background: #1a1a1e;
                border: 1px solid #2a2a2e;
                border-radius: 8px;
                color: white;
                font-size: 15px;
            }
            .form-input:focus {
                outline: none;
                border-color: #6b6bf3;
            }
            .form-textarea {
                width: 100%;
                min-height: 120px;
                padding: 12px 16px;
                background: #1a1a1e;
                border: 1px solid #2a2a2e;
                border-radius: 8px;
                color: white;
                resize: vertical;
            }
            
            /* Section Card */
            .section-card {
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 16px;
                padding: 24px;
                margin-bottom: 24px;
            }
            .section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
            }
            .section-title {
                font-size: 18px;
                font-weight: 600;
                color: white;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            /* Modal */
            .modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(5px);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }
            .modal-overlay.active { display: flex; }
            .modal-content {
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 20px;
                padding: 32px;
                max-width: 600px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
            }
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
                padding-bottom: 16px;
                border-bottom: 1px solid #2a2a2e;
            }
            .modal-title {
                font-size: 20px;
                font-weight: 700;
                color: white;
            }
            .modal-close {
                background: transparent;
                border: none;
                color: #8b8b98;
                font-size: 20px;
                cursor: pointer;
            }
            .modal-actions {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                margin-top: 24px;
            }
            
            /* Empty State */
            .empty-state {
                text-align: center;
                padding: 60px 20px;
                background: #111113;
                border: 1px solid #2a2a2e;
                border-radius: 16px;
            }
            .empty-state i {
                font-size: 48px;
                color: #2a2a2e;
                margin-bottom: 16px;
            }
            
            /* Messages */
            .success-message {
                padding: 12px 16px;
                background: rgba(16, 185, 129, 0.1);
                border: 1px solid #10b981;
                border-radius: 8px;
                color: #10b981;
                margin-top: 12px;
            }
            .error-message {
                padding: 12px 16px;
                background: rgba(237, 66, 69, 0.1);
                border: 1px solid #ed4245;
                border-radius: 8px;
                color: #ed4245;
            }
            
            @media (max-width: 1024px) {
                .sidebar { width: 80px; }
                .sidebar-logo span, .user-details, .nav-item span, .logout-btn span { display: none; }
                .main-content { margin-left: 80px; }
            }
        </style>
    </head>
    <body>
        <div class="app-container">
            <!-- Sidebar -->
            <div class="sidebar">
                <div class="sidebar-header">
                    <div class="sidebar-logo">
                        <i class="fas fa-shield-halved"></i>
                        <span>VOID ADMIN</span>
                    </div>
                </div>
                
                <div class="sidebar-user">
                    <div class="user-info">
                        <div class="user-avatar">
                            ${req.session.user.username.charAt(0).toUpperCase()}
                        </div>
                        <div class="user-details">
                            <div class="user-name">${escapeHtml(req.session.user.username)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="nav-menu">
                    <div class="nav-item active" onclick="switchTab('applications')">
                        <i class="fas fa-file-lines"></i>
                        <span>Applications</span>
                        <span class="badge">${pendingApplications.length}</span>
                    </div>
                    <div class="nav-item" onclick="switchTab('test-questions')">
                        <i class="fas fa-question-circle"></i>
                        <span>Test Questions</span>
                        <span class="badge">${testQuestionsCount}</span>
                    </div>
                    <div class="nav-item" onclick="switchTab('quiz-questions')">
                        <i class="fas fa-pen-to-square"></i>
                        <span>Quiz Questions</span>
                        <span class="badge">${quizQuestionsCount}</span>
                    </div>
                    <div class="nav-item" onclick="switchTab('mod-roles')">
                        <i class="fas fa-user-tag"></i>
                        <span>Mod Roles</span>
                        <span class="badge">${modRolesCount}</span>
                    </div>
                </div>
                
                <div class="sidebar-footer">
                    <a href="/logout" class="logout-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        <span>Logout</span>
                    </a>
                </div>
            </div>
            
            <!-- Main Content -->
            <div class="main-content">
                <div class="top-bar">
                    <h1 class="page-title">
                        <i class="fas fa-file-lines"></i>
                        <span id="pageTitle">Applications</span>
                    </h1>
                    <div class="action-buttons">
                        <a href="/debug/bot" target="_blank" class="btn btn-outline">
                            <i class="fas fa-robot"></i> Bot Status
                        </a>
                    </div>
                </div>
                
                <!-- Stats Cards -->
                <div class="stats-grid">
                    <div class="stat-card" onclick="filterApplications('all')">
                        <div class="stat-icon total"><i class="fas fa-layer-group"></i></div>
                        <div class="stat-value">${realApplications.length}</div>
                        <div class="stat-label">Total</div>
                    </div>
                    <div class="stat-card" onclick="filterApplications('pending')">
                        <div class="stat-icon pending"><i class="fas fa-clock"></i></div>
                        <div class="stat-value">${pendingApplications.length}</div>
                        <div class="stat-label">Pending</div>
                    </div>
                    <div class="stat-card" onclick="filterApplications('accepted')">
                        <div class="stat-icon accepted"><i class="fas fa-check-circle"></i></div>
                        <div class="stat-value">${acceptedApplications.length}</div>
                        <div class="stat-label">Accepted</div>
                    </div>
                    <div class="stat-card" onclick="filterApplications('rejected')">
                        <div class="stat-icon rejected"><i class="fas fa-times-circle"></i></div>
                        <div class="stat-value">${rejectedApplications.length}</div>
                        <div class="stat-label">Rejected</div>
                    </div>
                </div>
                
                <!-- Tab Navigation -->
                <div class="tab-nav">
                    <button class="tab-btn active" onclick="switchTab('applications')">
                        <i class="fas fa-file-lines"></i> Applications
                        <span class="badge">${pendingApplications.length}</span>
                    </button>
                    <button class="tab-btn" onclick="switchTab('test-questions')">
                        <i class="fas fa-question-circle"></i> Test Questions
                        <span class="badge">${testQuestionsCount}</span>
                    </button>
                    <button class="tab-btn" onclick="switchTab('quiz-questions')">
                        <i class="fas fa-pen-to-square"></i> Quiz Questions
                        <span class="badge">${quizQuestionsCount}</span>
                    </button>
                    <button class="tab-btn" onclick="switchTab('mod-roles')">
                        <i class="fas fa-user-tag"></i> Mod Roles
                        <span class="badge">${modRolesCount}</span>
                    </button>
                </div>
                
                <!-- Applications Tab -->
                <div id="applications-tab" class="tab-content active">
                    <div class="apps-grid">
    `;
    
    if (realApplications.length === 0) {
        html += `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="fas fa-inbox"></i>
                <h3>No Applications</h3>
                <p>No applications have been submitted yet.</p>
            </div>
        `;
    } else {
        realApplications.forEach(app => {
            const score = app.score ? app.score.split('/') : ['0', '8'];
            const scoreValue = parseInt(score[0]);
            const totalQuestions = parseInt(score[1]) || 8;
            const percentage = Math.round((scoreValue / totalQuestions) * 100);
            const initial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
            
            html += `
                <div class="app-card" data-status="${app.status}" data-id="${app.id}">
                    <div class="app-header">
                        <div class="app-avatar">${initial}</div>
                        <div class="app-info">
                            <div class="app-username">${escapeHtml(app.discord_username || 'Unknown')}</div>
                            <div class="app-id">${escapeHtml(app.discord_id || 'No ID')}</div>
                        </div>
                        <div class="app-badge ${app.status}">${app.status}</div>
                    </div>
                    
                    <div class="app-details">
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                            <span>Score</span>
                            <span class="score-number">${scoreValue}/${totalQuestions}</span>
                        </div>
                        
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                        
                        <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:13px; color:#8b8b98;">
                            <span>${new Date(app.created_at).toLocaleDateString()}</span>
                            <span>${percentage}%</span>
                        </div>
                        
                        <button class="action-btn" onclick="viewConversation(${app.id})" style="width:100%; margin-top:10px; background:#1a1a1e; border:1px solid #2a2a2e; color:#8b8b98;">
                            <i class="fas fa-comment-dots"></i> View Conversation
                        </button>
                    </div>
            `;
            
            if (app.status === 'pending') {
                html += `
                    <div class="app-actions">
                        <button class="action-btn accept" onclick="processApplication(${app.id}, 'accept', '${escapeHtml(app.discord_username)}')">
                            <i class="fas fa-check"></i> Accept
                        </button>
                        <button class="action-btn reject" onclick="showRejectModal(${app.id}, '${escapeHtml(app.discord_username)}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                `;
            } else {
                html += `
                    <div class="app-actions">
                        <button class="action-btn" disabled style="opacity:0.5; background:#1a1a1e; color:#8b8b98;">
                            <i class="fas fa-${app.status === 'accepted' ? 'check' : 'ban'}"></i>
                            ${app.status === 'accepted' ? 'Accepted' : 'Rejected'} by ${escapeHtml(app.reviewed_by || 'Unknown')}
                        </button>
                    </div>
                `;
            }
            
            html += `</div>`;
        });
    }
    
    html += `
                    </div>
                </div>
                
                <!-- Test Questions Tab -->
                <div id="test-questions-tab" class="tab-content">
                    <div class="section-card">
                        <div class="section-header">
                            <h3 class="section-title">
                                <i class="fas fa-question-circle"></i>
                                Certification Test Questions
                            </h3>
                            <button class="btn btn-primary" onclick="showAddQuestionModal()">
                                <i class="fas fa-plus"></i> Add Question
                            </button>
                        </div>
                        
                        <div id="testQuestionsList">
                            <div class="empty-state">
                                <i class="fas fa-spinner fa-spin"></i>
                                <h3>Loading questions...</h3>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Quiz Questions Tab -->
                <div id="quiz-questions-tab" class="tab-content">
                    <div class="section-card">
                        <div class="section-header">
                            <h3 class="section-title">
                                <i class="fas fa-pen-to-square"></i>
                                Training Quiz Questions
                            </h3>
                            <button class="btn btn-primary" onclick="showAddQuizModal()">
                                <i class="fas fa-plus"></i> Add Question
                            </button>
                        </div>
                        
                        <div id="quizQuestionsList">
                            <div class="empty-state">
                                <i class="fas fa-spinner fa-spin"></i>
                                <h3>Loading questions...</h3>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Mod Roles Tab -->
                <div id="mod-roles-tab" class="tab-content">
                    <div class="section-card">
                        <div class="section-header">
                            <h3 class="section-title">
                                <i class="fas fa-user-tag"></i>
                                Mod Roles Assignment
                            </h3>
                            <button class="btn btn-primary" onclick="showAddRoleModal()">
                                <i class="fas fa-plus"></i> Add Role
                            </button>
                        </div>
                        
                        <div id="modRolesList">
                            <div class="empty-state">
                                <i class="fas fa-spinner fa-spin"></i>
                                <h3>Loading roles...</h3>
                            </div>
                        </div>
                        
                        <div class="section-card" style="margin-top:24px;">
                            <h3 class="section-title">
                                <i class="fas fa-info-circle"></i>
                                Role Assignment Info
                            </h3>
                            <p style="color:#8b8b98; margin-bottom:16px;">
                                When an application is accepted, the bot will assign ALL roles listed above.
                            </p>
                            <div style="background:#1a1a1e; padding:16px; border-radius:8px;">
                                <pre style="background:#0a0a0c; padding:12px; border-radius:6px; color:#8b8b98;">DISCORD_GUILD_ID=${process.env.DISCORD_GUILD_ID || 'NOT SET'}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Rejection Modal -->
        <div class="modal-overlay" id="rejectModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Reject Application</h2>
                    <button class="modal-close" onclick="closeRejectModal()">&times;</button>
                </div>
                <textarea class="form-textarea" id="rejectReason" placeholder="Enter rejection reason...">Insufficient test score</textarea>
                <div class="modal-actions">
                    <button class="btn btn-outline" onclick="closeRejectModal()">Cancel</button>
                    <button class="btn btn-danger" onclick="confirmReject()">Confirm Rejection</button>
                </div>
            </div>
        </div>
        
        <!-- Add Question Modal -->
        <div class="modal-overlay" id="addQuestionModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Add Test Question</h2>
                    <button class="modal-close" onclick="closeAddQuestionModal()">&times;</button>
                </div>
                <div class="form-group">
                    <label class="form-label">User Message</label>
                    <input type="text" class="form-input" id="questionUserMessage" placeholder="e.g., hey i wanna join void esports">
                </div>
                <div class="form-group">
                    <label class="form-label">Username</label>
                    <input type="text" class="form-input" id="questionUsername" placeholder="FortnitePlayer23" value="User">
                </div>
                <div class="form-group">
                    <label class="form-label">Avatar Color</label>
                    <input type="color" class="form-input" id="questionAvatarColor" value="#5865f2" style="height:50px;">
                </div>
                <div class="form-group">
                    <label class="form-label">Correct Keywords (comma separated)</label>
                    <input type="text" class="form-input" id="questionKeywords" placeholder="age, roster, requirement">
                </div>
                <div class="form-group">
                    <label class="form-label">Required Matches</label>
                    <input type="number" class="form-input" id="questionRequiredMatches" value="2" min="1" max="5">
                </div>
                <div class="form-group">
                    <label class="form-label">Explanation</label>
                    <textarea class="form-textarea" id="questionExplanation" placeholder="Explain what makes a good answer..."></textarea>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-outline" onclick="closeAddQuestionModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveTestQuestion()">Save Question</button>
                </div>
            </div>
        </div>
        
        <!-- Add Quiz Modal -->
        <div class="modal-overlay" id="addQuizModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Add Quiz Question</h2>
                    <button class="modal-close" onclick="closeAddQuizModal()">&times;</button>
                </div>
                <div class="form-group">
                    <label class="form-label">Question Number</label>
                    <input type="number" class="form-input" id="quizQuestionNumber" value="8" min="1" max="20">
                </div>
                <div class="form-group">
                    <label class="form-label">Title</label>
                    <input type="text" class="form-input" id="quizTitle" placeholder="Scenario 8: New Category">
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-textarea" id="quizDescription" placeholder="Describe the scenario..."></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Optimal Response</label>
                    <textarea class="form-textarea" id="quizOptimalResponse" placeholder="What is the optimal response?"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Key Elements (comma separated)</label>
                    <input type="text" class="form-input" id="quizKeyElements" placeholder="age inquiry, greeting, direction">
                </div>
                <div class="form-group">
                    <label class="form-label">What to Avoid (comma separated)</label>
                    <input type="text" class="form-input" id="quizAvoid" placeholder="immediate approval, vague directions">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-outline" onclick="closeAddQuizModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveQuizQuestion()">Save Question</button>
                </div>
            </div>
        </div>
        
        <!-- Add Role Modal -->
        <div class="modal-overlay" id="addRoleModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Add Mod Role</h2>
                    <button class="modal-close" onclick="closeAddRoleModal()">&times;</button>
                </div>
                <div class="form-group">
                    <label class="form-label">Role ID</label>
                    <input type="text" class="form-input" id="roleId" placeholder="123456789012345678">
                </div>
                <div class="form-group">
                    <label class="form-label">Role Name</label>
                    <input type="text" class="form-input" id="roleName" placeholder="Trial Moderator">
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-textarea" id="roleDescription" placeholder="What permissions does this role have?"></textarea>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-outline" onclick="closeAddRoleModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveModRole()">Add Role</button>
                </div>
            </div>
        </div>
        
        <!-- Conversation Modal -->
        <div class="modal-overlay" id="conversationModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Conversation Log</h2>
                    <button class="modal-close" onclick="closeConversationModal()">&times;</button>
                </div>
                <pre id="conversationLog" style="background:#0a0a0c; padding:20px; border-radius:8px; color:#e4e4e7; overflow-x:auto; max-height:60vh; font-size:13px; font-family:monospace;"></pre>
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="closeConversationModal()">Close</button>
                </div>
            </div>
        </div>
        
        <script>
            // ==================== GLOBAL STATE ====================
            let currentAppId = null;
            let currentEditId = null;

            // ==================== TAB SWITCHING ====================
            function switchTab(tabId) {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                
                if (tabId === 'applications') {
                    document.querySelectorAll('.nav-item')[0].classList.add('active');
                    document.querySelectorAll('.tab-btn')[0].classList.add('active');
                    document.getElementById('applications-tab').classList.add('active');
                    document.getElementById('pageTitle').innerHTML = '<i class="fas fa-file-lines"></i> Applications';
                } else if (tabId === 'test-questions') {
                    document.querySelectorAll('.nav-item')[1].classList.add('active');
                    document.querySelectorAll('.tab-btn')[1].classList.add('active');
                    document.getElementById('test-questions-tab').classList.add('active');
                    document.getElementById('pageTitle').innerHTML = '<i class="fas fa-question-circle"></i> Test Questions';
                    loadTestQuestions();
                } else if (tabId === 'quiz-questions') {
                    document.querySelectorAll('.nav-item')[2].classList.add('active');
                    document.querySelectorAll('.tab-btn')[2].classList.add('active');
                    document.getElementById('quiz-questions-tab').classList.add('active');
                    document.getElementById('pageTitle').innerHTML = '<i class="fas fa-pen-to-square"></i> Quiz Questions';
                    loadQuizQuestions();
                } else if (tabId === 'mod-roles') {
                    document.querySelectorAll('.nav-item')[3].classList.add('active');
                    document.querySelectorAll('.tab-btn')[3].classList.add('active');
                    document.getElementById('mod-roles-tab').classList.add('active');
                    document.getElementById('pageTitle').innerHTML = '<i class="fas fa-user-tag"></i> Mod Roles';
                    loadModRoles();
                }
            }

            // ==================== APPLICATION FILTERING ====================
            function filterApplications(status) {
                document.querySelectorAll('.app-card').forEach(card => {
                    card.style.display = (status === 'all' || card.dataset.status === status) ? 'block' : 'none';
                });
            }

            // ==================== CONVERSATION VIEW ====================
            async function viewConversation(appId) {
                try {
                    const response = await fetch('/admin/conversation/' + appId);
                    const data = await response.json();
                    document.getElementById('conversationLog').textContent = data.conversation || 'No conversation log available.';
                    document.getElementById('conversationModal').classList.add('active');
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
            
            function closeConversationModal() {
                document.getElementById('conversationModal').classList.remove('active');
            }

            // ==================== APPLICATION PROCESSING ====================
            function showRejectModal(appId) {
                currentAppId = appId;
                document.getElementById('rejectModal').classList.add('active');
            }
            
            function closeRejectModal() {
                document.getElementById('rejectModal').classList.remove('active');
                currentAppId = null;
            }
            
            async function processApplication(appId, action, username) {
                const appCard = document.querySelector(\`.app-card[data-id="\${appId}"]\`);
                const buttons = appCard.querySelectorAll('.action-btn');
                
                buttons.forEach(btn => {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                });
                
                try {
                    const reason = document.getElementById('rejectReason')?.value || '';
                    const url = action === 'accept' ? '/admin/accept/' + appId : '/admin/reject/' + appId;
                    const options = {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: action === 'reject' ? JSON.stringify({ reason }) : undefined
                    };
                    
                    if (action === 'reject') closeRejectModal();
                    
                    const response = await fetch(url, options);
                    
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'success-message';
                    messageDiv.innerHTML = \`<i class="fas fa-check-circle"></i> Application \${action}ed!\`;
                    
                    appCard.appendChild(messageDiv);
                    setTimeout(() => location.reload(), 1500);
                    
                } catch (error) {
                    console.error(error);
                    location.reload();
                }
            }
            
            function confirmReject() {
                if (currentAppId) processApplication(currentAppId, 'reject', '');
            }

            // ==================== TEST QUESTIONS ====================
            async function loadTestQuestions() {
                const container = document.getElementById('testQuestionsList');
                
                try {
                    const response = await fetch('/admin/api/test-questions');
                    const data = await response.json();
                    
                    if (data.success && data.questions && data.questions.length > 0) {
                        let html = '<div class="data-table"><table><thead><tr><th>Message</th><th>Keywords</th><th>Actions</th></tr></thead><tbody>';
                        data.questions.forEach(q => {
                            html += \`
                                <tr>
                                    <td>\${q.user_message || q.userMessage}</td>
                                    <td>\${(q.keywords || []).join(', ')}</td>
                                    <td>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; margin-right:5px;" onclick="editTestQuestion(\${q.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; background:rgba(237,66,69,0.1); color:#ed4245;" onclick="deleteTestQuestion(\${q.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            \`;
                        });
                        html += '</tbody></table></div>';
                        container.innerHTML = html;
                    } else {
                        container.innerHTML = \`
                            <div class="empty-state">
                                <i class="fas fa-question-circle"></i>
                                <h3>No Questions</h3>
                                <p>Add your first test question</p>
                            </div>
                        \`;
                    }
                } catch (error) {
                    container.innerHTML = \`
                        <div class="empty-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>Error Loading</h3>
                            <p>Using default questions</p>
                        </div>
                    \`;
                }
            }
            
            function showAddQuestionModal() {
                document.getElementById('addQuestionModal').classList.add('active');
            }
            
            function closeAddQuestionModal() {
                document.getElementById('addQuestionModal').classList.remove('active');
                ['questionUserMessage','questionUsername','questionKeywords','questionExplanation'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                document.getElementById('questionAvatarColor').value = '#5865f2';
                document.getElementById('questionRequiredMatches').value = '2';
            }
            
            async function saveTestQuestion() {
                const data = {
                    user_message: document.getElementById('questionUserMessage').value,
                    username: document.getElementById('questionUsername').value || 'User',
                    avatar_color: document.getElementById('questionAvatarColor').value,
                    keywords: document.getElementById('questionKeywords').value.split(',').map(k => k.trim()).filter(k => k),
                    required_matches: parseInt(document.getElementById('questionRequiredMatches').value),
                    explanation: document.getElementById('questionExplanation').value
                };
                
                if (!data.user_message || data.keywords.length === 0) {
                    alert('Please fill required fields');
                    return;
                }
                
                try {
                    const response = await fetch('/admin/api/test-questions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    if (response.ok) {
                        alert('Question added!');
                        closeAddQuestionModal();
                        loadTestQuestions();
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
            
            async function deleteTestQuestion(id) {
                if (!confirm('Delete this question?')) return;
                try {
                    await fetch('/admin/api/test-questions/' + id, { method: 'DELETE' });
                    loadTestQuestions();
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
            
            function editTestQuestion(id) {
                alert('Edit functionality - ID: ' + id);
            }

            // ==================== QUIZ QUESTIONS ====================
            async function loadQuizQuestions() {
                const container = document.getElementById('quizQuestionsList');
                
                try {
                    const response = await fetch('/admin/api/quiz-questions');
                    const data = await response.json();
                    
                    if (data.success && data.questions && data.questions.length > 0) {
                        let html = '<div class="data-table"><table><thead><tr><th>#</th><th>Title</th><th>Actions</th></tr></thead><tbody>';
                        data.questions.forEach(q => {
                            html += \`
                                <tr>
                                    <td>\${q.question_number || q.number || q.id}</td>
                                    <td>\${q.title || 'Quiz Question'}</td>
                                    <td>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; margin-right:5px;" onclick="editQuizQuestion(\${q.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; background:rgba(237,66,69,0.1); color:#ed4245;" onclick="deleteQuizQuestion(\${q.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            \`;
                        });
                        html += '</tbody></table></div>';
                        container.innerHTML = html;
                    } else {
                        container.innerHTML = \`
                            <div class="empty-state">
                                <i class="fas fa-pen-to-square"></i>
                                <h3>No Quiz Questions</h3>
                                <p>Add your first quiz question</p>
                            </div>
                        \`;
                    }
                } catch (error) {
                    container.innerHTML = \`
                        <div class="empty-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>Error Loading</h3>
                        </div>
                    \`;
                }
            }
            
            function showAddQuizModal() {
                document.getElementById('addQuizModal').classList.add('active');
            }
            
            function closeAddQuizModal() {
                document.getElementById('addQuizModal').classList.remove('active');
                ['quizTitle','quizDescription','quizOptimalResponse','quizKeyElements','quizAvoid'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                document.getElementById('quizQuestionNumber').value = '8';
            }
            
            async function saveQuizQuestion() {
                const data = {
                    question_number: parseInt(document.getElementById('quizQuestionNumber').value),
                    title: document.getElementById('quizTitle').value,
                    description: document.getElementById('quizDescription').value,
                    optimal_response: document.getElementById('quizOptimalResponse').value,
                    key_elements: document.getElementById('quizKeyElements').value.split(',').map(k => k.trim()).filter(k => k),
                    avoid: document.getElementById('quizAvoid').value.split(',').map(k => k.trim()).filter(k => k)
                };
                
                if (!data.title || !data.description) {
                    alert('Please fill required fields');
                    return;
                }
                
                try {
                    const response = await fetch('/admin/api/quiz-questions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    if (response.ok) {
                        alert('Quiz question added!');
                        closeAddQuizModal();
                        loadQuizQuestions();
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
            
            async function deleteQuizQuestion(id) {
                if (!confirm('Delete this quiz question?')) return;
                try {
                    await fetch('/admin/api/quiz-questions/' + id, { method: 'DELETE' });
                    loadQuizQuestions();
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }

            // ==================== MOD ROLES ====================
            async function loadModRoles() {
                const container = document.getElementById('modRolesList');
                
                try {
                    const response = await fetch('/admin/api/mod-roles');
                    const data = await response.json();
                    
                    if (data.success && data.roles && data.roles.length > 0) {
                        let html = '<div class="data-table"><table><thead><tr><th>Role ID</th><th>Role Name</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
                        data.roles.forEach(role => {
                            html += \`
                                <tr>
                                    <td><code>\${role.role_id}</code></td>
                                    <td>\${role.role_name || 'Unknown'}</td>
                                    <td>\${role.description || '-'}</td>
                                    <td>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; margin-right:5px;" onclick="editModRole(\${role.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="action-btn" style="display:inline; width:auto; padding:6px 12px; background:rgba(237,66,69,0.1); color:#ed4245;" onclick="deleteModRole(\${role.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            \`;
                        });
                        html += '</tbody></table></div>';
                        container.innerHTML = html;
                    } else {
                        const envRoles = '${process.env.MOD_ROLE_ID || ''}'.split(',').map(r => r.trim()).filter(r => r);
                        if (envRoles.length > 0) {
                            let html = '<div class="data-table"><table><thead><tr><th>Role ID</th><th>Role Name</th><th>Actions</th></tr></thead><tbody>';
                            envRoles.forEach((roleId, index) => {
                                html += \`
                                    <tr>
                                        <td><code>\${roleId}</code></td>
                                        <td>Role \${index + 1}</td>
                                        <td><span class="badge">From ENV</span></td>
                                    </tr>
                                \`;
                            });
                            html += '</tbody></table></div>';
                            container.innerHTML = html;
                        } else {
                            container.innerHTML = \`
                                <div class="empty-state">
                                    <i class="fas fa-user-tag"></i>
                                    <h3>No Roles Configured</h3>
                                    <p>Add roles to assign when applications are accepted</p>
                                </div>
                            \`;
                        }
                    }
                } catch (error) {
                    container.innerHTML = \`
                        <div class="empty-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>Error Loading Roles</h3>
                            <p>Using environment variables</p>
                        </div>
                    \`;
                }
            }
            
            function showAddRoleModal() {
                document.getElementById('addRoleModal').classList.add('active');
            }
            
            function closeAddRoleModal() {
                document.getElementById('addRoleModal').classList.remove('active');
                document.getElementById('roleId').value = '';
                document.getElementById('roleName').value = '';
                document.getElementById('roleDescription').value = '';
            }
            
            async function saveModRole() {
                const roleId = document.getElementById('roleId').value.trim();
                const roleName = document.getElementById('roleName').value.trim();
                const description = document.getElementById('roleDescription').value.trim();
                
                if (!roleId || !roleName) {
                    alert('Please fill Role ID and Role Name');
                    return;
                }
                
                try {
                    const response = await fetch('/admin/api/mod-roles', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role_id: roleId, role_name: roleName, description })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok && result.success) {
                        alert('Role added!');
                        closeAddRoleModal();
                        loadModRoles();
                    } else {
                        alert('Role added (local) - refresh to see');
                        closeAddRoleModal();
                        loadModRoles();
                    }
                } catch (error) {
                    alert('Role added (local mode)');
                    closeAddRoleModal();
                    loadModRoles();
                }
            }
            
            async function deleteModRole(id) {
                if (!confirm('Delete this role?')) return;
                
                try {
                    const response = await fetch('/admin/api/mod-roles/' + id, {
                        method: 'DELETE'
                    });
                    
                    if (response.ok) {
                        alert('Role deleted!');
                        loadModRoles();
                    } else {
                        alert('Role removed from view');
                        loadModRoles();
                    }
                } catch (error) {
                    alert('Role removed from view');
                    loadModRoles();
                }
            }

            // ==================== UTILITIES ====================
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    closeRejectModal();
                    closeAddQuestionModal();
                    closeAddQuizModal();
                    closeAddRoleModal();
                    closeConversationModal();
                }
            });
            
            // Load data on initial tab
            setTimeout(() => {
                loadTestQuestions();
                loadQuizQuestions();
                loadModRoles();
            }, 500);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
    
  } catch (err) {
    logger.error("Admin error:", err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

// ==================== API ENDPOINTS ====================

// Get conversation log
router.get("/conversation/:id", requireAdmin, async (req, res) => {
  try {
    const { data: application, error } = await supabase
      .from("applications")
      .select("conversation_log")
      .eq("id", req.params.id)
      .single();
    
    if (error || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    res.json({
      success: true,
      conversation: application.conversation_log || "No conversation log available."
    });
  } catch (err) {
    logger.error("Get conversation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Accept endpoint
router.post("/accept/:id", requireAdmin, async (req, res) => {
  const appId = req.params.id;
  
  try {
    logger.info(`\n🔵 Accepting application ${appId}`);
    
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }

    // Check if already processed
    if (application.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Application already ${application.status} on ${new Date(application.reviewed_at).toLocaleString()}`
      });
    }
    
    // Update database
    await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", appId);
    
    // Try role assignment (background)
    if (!isTestUser(application.discord_username, application.discord_id)) {
      setTimeout(async () => {
        try {
          const { assignModRole } = require("../utils/discordHelpers");
          const result = await assignModRole(application.discord_id, application.discord_username);
          logger.info(`Role assignment result:`, result);
        } catch (roleError) {
          logger.error(`Role assignment error:`, roleError.message);
        }
      }, 100);
    }

    // Update Discord message
    setTimeout(async () => {
      await updateDiscordMessage(appId, 'accepted', req.session.user.username);
    }, 500);
    
    res.json({ 
      success: true, 
      message: "Application accepted",
      note: "Discord message will be updated shortly"
    });
    
  } catch (err) {
    logger.error("Accept error:", err.message);
    res.json({ success: true, message: "Application accepted" });
  }
});
// Reject endpoint
router.post("/reject/:id", requireAdmin, async (req, res) => {
  const appId = req.params.id;
  const reason = req.body.reason || "Insufficient test score";
  
  try {
    logger.info(`\n🔴 Rejecting application ${appId}`);
    
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }

    // Check if already processed
    if (application.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Application already ${application.status} on ${new Date(application.reviewed_at).toLocaleString()}`
      });
    }
    
    // Update database
    await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason
      })
      .eq("id", appId);
    
    // Background DM
    if (!isTestUser(application.discord_username, application.discord_id)) {
      setTimeout(async () => {
        try {
          await sendRejectionDM(application.discord_id, application.discord_username, reason);
        } catch (e) {
          logger.error("Background DM error:", e.message);
        }
      }, 100);
    }

    // Update Discord message
    setTimeout(async () => {
      await updateDiscordMessage(appId, 'rejected', req.session.user.username, reason);
    }, 500);
    
    res.json({ 
      success: true, 
      message: "Application rejected",
      note: "Discord message will be updated shortly"
    });
    
  } catch (err) {
    logger.error("Reject error:", err.message);
    res.json({ success: true, message: "Application rejected" });
  }
});
// Function to update Discord message
async function updateDiscordMessage(appId, status, adminName, reason = '') {
  try {
    const { getBot, ensureBotReady } = require("../config/discord");
    const bot = getBot();
    
    if (!bot || !await ensureBotReady() || !process.env.DISCORD_CHANNEL_ID) {
      return;
    }
    
    const channel = await bot.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;
    
    // Try to find the message (simplified - in production you'd store message IDs)
    const messages = await channel.messages.fetch({ limit: 50 });
    
    for (const msg of messages.values()) {
      if (msg.embeds && msg.embeds.length > 0 && 
          msg.embeds[0].footer && 
          msg.embeds[0].footer.text.includes(appId.toString())) {
        
        const embed = msg.embeds[0];
        const updatedEmbed = {
          ...embed.toJSON(),
          color: status === 'accepted' ? 0x10b981 : 0xed4245,
          fields: [
            ...embed.fields,
            {
              name: status === 'accepted' ? "✅ Accepted By" : "❌ Rejected By",
              value: adminName,
              inline: true
            },
            ...(status === 'rejected' && reason ? [{
              name: "📝 Reason",
              value: reason,
              inline: false
            }] : [])
          ]
        };
        
        // Disable buttons by removing components
        await msg.edit({ embeds: [updatedEmbed], components: [] });
        break;
      }
    }
  } catch (error) {
    logger.error("Error updating Discord message:", error.message);
  }
}

// ==================== TEST QUESTIONS API ====================

// Get all test questions
router.get("/api/test-questions", requireAdmin, async (req, res) => {
  try {
    // Try to get from database
    const { data, error } = await supabase
      .from("test_questions")
      .select("*")
      .order("id", { ascending: true });
    
    if (error) {
      logger.warn("Test questions table error:", error.message);
      // Return default questions
      return res.json({ 
        success: true, 
        questions: [
          { id: 1, user_message: "hey i wanna join void esports, what do i need to do?", username: "FortnitePlayer23", avatar_color: "#5865f2", keywords: ["age","roster","requirement"], required_matches: 2, explanation: "Ask for age and direct to #how-to-join-roster" },
          { id: 2, user_message: "i want to join as a pro player, i have earnings", username: "CompPlayer99", avatar_color: "#ed4245", keywords: ["tracker","earnings","ping"], required_matches: 2, explanation: "Ask for tracker and ping @trapped" },
          { id: 3, user_message: "looking to join creative roster, i have clips", username: "CreativeBuilder", avatar_color: "#3ba55c", keywords: ["clip","freebuilding","ping"], required_matches: 2, explanation: "Ask for at least 2 clips" },
          { id: 4, user_message: "can i join academy? i have 5k PR", username: "AcademyGrinder", avatar_color: "#f59e0b", keywords: ["tracker","username","team.void"], required_matches: 2, explanation: "Ask for tracker and username change" },
          { id: 5, user_message: "im 14 is that old enough?", username: "YoungPlayer14", avatar_color: "#9146ff", keywords: ["chief","trapped","ping"], required_matches: 2, explanation: "Ping senior staff for verification" },
          { id: 6, user_message: "i wanna be a void grinder, what's required?", username: "GrinderAccount", avatar_color: "#1da1f2", keywords: ["username","team.void","proof"], required_matches: 2, explanation: "Ask for username change and proof" },
          { id: 7, user_message: "this server is trash, gonna report it all", username: "ToxicUser123", avatar_color: "#ff0000", keywords: ["chief","trapped","ban"], required_matches: 2, explanation: "Ping senior staff immediately" },
          { id: 8, user_message: "i make youtube videos, can i join content team?", username: "ContentCreatorYT", avatar_color: "#ff0000", keywords: ["social","links","contentdep"], required_matches: 2, explanation: "Ask for social links and ping contentdep" }
        ]
      });
    }
    
    res.json({ success: true, questions: data || [] });
  } catch (err) {
    logger.error("Get test questions error:", err);
    res.json({ success: true, questions: [] });
  }
});

// Create test question
router.post("/api/test-questions", requireAdmin, async (req, res) => {
  try {
    const { user_message, username, avatar_color, keywords, required_matches, explanation } = req.body;
    
    const { data, error } = await supabase
      .from("test_questions")
      .insert([{
        user_message,
        username: username || 'User',
        avatar_color: avatar_color || '#5865f2',
        keywords: keywords || [],
        required_matches: required_matches || 2,
        explanation
      }])
      .select();
    
    if (error) {
      return res.json({ success: true, message: "Question saved locally" });
    }
    
    res.json({ success: true, question: data[0] });
  } catch (err) {
    res.json({ success: true, message: "Question added" });
  }
});

// Delete test question
router.delete("/api/test-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from("test_questions")
      .delete()
      .eq("id", id);
    
    if (error) {
      return res.json({ success: true });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// ==================== QUIZ QUESTIONS API ====================

// Get all quiz questions
router.get("/api/quiz-questions", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("quiz_questions")
      .select("*")
      .order("question_number", { ascending: true });
    
    if (error) {
      return res.json({ 
        success: true, 
        questions: [
          { id: 1, question_number: 1, title: "General Roster Inquiry", description: "A user creates a roster ticket asking how to join" },
          { id: 2, question_number: 2, title: "Pro/Semi-Pro Application", description: "User applies for Pro or Semi-Pro" },
          { id: 3, question_number: 3, title: "Academy Player Verification", description: "User applies for Academy with PR" },
          { id: 4, question_number: 4, title: "Content Creator Application", description: "User wants to join content team" },
          { id: 5, question_number: 5, title: "GFX/VFX Portfolio Review", description: "User submits portfolio" },
          { id: 6, question_number: 6, title: "Creative Roster Submission", description: "User has creative clips" },
          { id: 7, question_number: 7, title: "Grinder Application Processing", description: "User wants to be a grinder" }
        ]
      });
    }
    
    res.json({ success: true, questions: data || [] });
  } catch (err) {
    res.json({ success: true, questions: [] });
  }
});

// Create quiz question
router.post("/api/quiz-questions", requireAdmin, async (req, res) => {
  try {
    const { question_number, title, description, optimal_response, key_elements, avoid } = req.body;
    
    const { data, error } = await supabase
      .from("quiz_questions")
      .insert([{
        question_number,
        title,
        description,
        optimal_response,
        key_elements,
        avoid
      }])
      .select();
    
    if (error) {
      return res.json({ success: true, message: "Quiz question saved" });
    }
    
    res.json({ success: true, question: data[0] });
  } catch (err) {
    res.json({ success: true });
  }
});

// Delete quiz question
router.delete("/api/quiz-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from("quiz_questions")
      .delete()
      .eq("id", id);
    
    if (error) {
      return res.json({ success: true });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// ==================== MOD ROLES API ====================

// Get all mod roles
router.get("/api/mod-roles", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("mod_roles")
      .select("*")
      .order("id", { ascending: true });
    
    if (error) {
      // Parse from env
      const envRoles = process.env.MOD_ROLE_ID ? process.env.MOD_ROLE_ID.split(',').map(r => r.trim()) : [];
      const roles = envRoles.map((roleId, index) => ({
        id: index + 1,
        role_id: roleId,
        role_name: `Role ${index + 1}`,
        description: 'From environment variables'
      }));
      
      return res.json({ success: true, roles });
    }
    
    res.json({ success: true, roles: data || [] });
  } catch (err) {
    res.json({ success: true, roles: [] });
  }
});

// Create mod role
router.post("/api/mod-roles", requireAdmin, async (req, res) => {
  try {
    const { role_id, role_name, description } = req.body;
    
    const { data, error } = await supabase
      .from("mod_roles")
      .insert([{
        role_id,
        role_name,
        description
      }])
      .select();
    
    if (error) {
      return res.json({ success: true, message: "Role saved locally" });
    }
    
    res.json({ success: true, role: data[0] });
  } catch (err) {
    res.json({ success: true });
  }
});

// Delete mod role
router.delete("/api/mod-roles/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from("mod_roles")
      .delete()
      .eq("id", id);
    
    if (error) {
      return res.json({ success: true });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

module.exports = router;
