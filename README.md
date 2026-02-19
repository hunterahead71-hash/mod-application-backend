# 🚀 Void Esports Mod Application Backend

Complete backend system for Void Esports moderator certification and training platform.

## ✅ Latest Update: Complete Command System Overhaul

**All Discord slash commands are now working!**

### Available Commands (9 Total)

1. **`/test-question`** - Manage certification test questions
2. **`/cert-role`** - Manage certification roles  
3. **`/cert-analytics`** - View analytics and statistics
4. **`/cert-bulk`** - Bulk operations on questions
5. **`/cert-simulate`** - Simulate test submissions
6. **`/cert-question-stats`** - Question statistics
7. **`/cert-quick`** - Quick actions for applications
8. **`/cert-status`** - Bot health and system status
9. **`/cert-help`** - Help command (public, no admin needed)

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

## 🔧 Features

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
