# 🚀 Void Esports Mod Application Backend

Complete backend system for Void Esports moderator certification and training platform.

## ✅ Latest Update: Complete Command System Overhaul

**All Discord slash commands are now working!**

### Available Commands (12 Total)

1. **`/add-admin-role`** - Add a Discord role that can use bot admin commands
2. **`/delete-admin-role`** - Remove a role from bot admin access
3. **`/show-admin-role`** - Show which roles have bot admin access (no hardcoded roles)
4. **`/test-question`** - Manage certification test questions
5. **`/cert-role`** - Manage certification roles  
6. **`/cert-analytics`** - View analytics and statistics
7. **`/cert-bulk`** - Bulk operations on questions
8. **`/cert-simulate`** - Simulate test submissions
9. **`/cert-question-stats`** - Question statistics
10. **`/cert-quick`** - Quick actions for applications
11. **`/cert-status`** - Bot health and system status
12. **`/cert-help`** - Help command (public, no admin needed)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Discord Bot Token
- Supabase Account
- Render Account (or similar hosting)

### Environment Variables

```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id
DISCORD_CHANNEL_ID=your_channel_id
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
ADMIN_ROLE_IDS=role_id_1,role_id_2  # Optional
```

### Installation

```bash
cd void-bot-backend
npm install
npm start
```

### Deploy Commands

```bash
npm run deploy-commands
```

## 📚 Documentation

- See `COMMAND_DEPLOYMENT_GUIDE.md` for detailed deployment instructions
- See `FINAL_SUMMARY.md` for complete fix summary
- See `MIGRATION_GUIDE.md` for database setup
- Run Supabase migrations in `supabase/migrations/` (including `20250620000000_bot_admin_roles.sql`) so `/add-admin-role` and `/show-admin-role` work.

## 🔧 Features

- ✅ **Configurable admin roles** – `/add-admin-role`, `/delete-admin-role`, `/show-admin-role` (stored in DB, no hardcoded roles)
- ✅ Dynamic question management via Discord commands
- ✅ Dynamic role assignment system
- ✅ Comprehensive analytics dashboard
- ✅ Bulk operations for efficiency
- ✅ Test simulation for testing
- ✅ Quick actions for common tasks
- ✅ Bot health monitoring
- ✅ Public help system

## 🐛 Troubleshooting

### Commands Not Appearing

1. Verify `DISCORD_CLIENT_ID` is set
2. Check Render logs for registration errors
3. Run `npm run deploy-commands` manually
4. Wait up to 1 hour for global commands

### Commands Timing Out

- All commands now defer immediately - this should be fixed
- Check Render logs for specific errors
- Verify database connection

## 📝 License

Private - Void Esports
