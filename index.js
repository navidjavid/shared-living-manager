// index.js (Main Refactored File)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (reason, promise) => { console.error('🚨 Unhandled Rejection:', reason); if (reason && reason.stack) console.error(reason.stack); });
process.on('uncaughtException', (error) => { console.error('🚨 Uncaught Exception:', error); if (error && error.stack) console.error(error.stack); process.exit(1); });

console.log('[INDEX] Script starting...');

const envConfig = require('./config/envConfig');
console.log('[INDEX] Environment configuration loaded.');

const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./config/db'); // Import pool for PgSession & potentially graceful shutdown
const bot = require('./bot/botInstance');
const setupBotHandlers = require('./bot/botHandlers');
const { ensureAuthenticated } = require('./middleware/authMiddleware');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { startCronJobs } = require('./jobs/cronJobs');

const app = express();
console.log('[INDEX] Express app initialized.');
// TRUST THE REVERSE PROXY (RENDER)
// This should be set before app.use(session(...))
app.set('trust proxy', 1); // Trusts the first hop from the proxy
console.log('[INDEX] Set "trust proxy" to 1.');

// --- Session Configuration ---
app.use(session({
    store: new PgSession({
        pool : pool,
        tableName : 'user_sessions',
        createTableIfMissing: true // This is good to keep
    }),
    secret: envConfig.SESSION_SECRET,
    resave: false, // Recommended: false
    saveUninitialized: false, // Recommended: false (don't save session if nothing is modified)
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: false, // IMPORTANT for HTTPS on Render
        httpOnly: true, // Good security practice
        sameSite: 'Lax' // Good default for most apps, helps with CSRF
    },
    // Consider adding a name for your session cookie if you have multiple apps on the same domain
    // name: 'wgmanager.sid' 
}));
console.log('[INDEX] Express session configured.');

// --- Express App Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
console.log('[INDEX] Express core middleware and view engine setup complete.');

// --- Routes ---
app.use('/', authRoutes); // Login, logout routes (e.g., /login, /logout)
app.use('/', ensureAuthenticated, adminRoutes); // Protected admin panel routes (e.g., /, /expenses)
console.log('[INDEX] Web routes configured.');

// --- Setup Bot Handlers ---
setupBotHandlers(bot); // Pass the bot instance to configure its handlers

// --- Start Cron Jobs ---
startCronJobs(); // Schedules the cron jobs defined in jobs/cronJobs.js


// --- Bot Launch and Server Listen ---
console.log(`[INDEX] Preparing to launch bot and start Express server on port ${envConfig.PORT}...`);
let botLaunchedSuccessfully = false;
let serverListeningSuccessfully = false;

console.log('[INDEX] Attempting bot.launch()...');
bot.launch()
  .then(() => {
    botLaunchedSuccessfully = true;
    console.log('✅🤖 Bot started successfully!');
    if (serverListeningSuccessfully) console.log('[INDEX] Bot launched, server already listening.');
  })
  .catch(err => {
    console.error("❌❌❌ Telegraf Bot failed to launch: ❌❌❌");
    console.error("Error Message:", err.message);
    if (err.stack) console.error("Stack Trace:\n", err.stack);
    // Consider if a bot launch failure should prevent server from starting or if web panel can run independently
  });

console.log('[INDEX] Attempting app.listen()...');
const server = app.listen(envConfig.PORT, () => {
  serverListeningSuccessfully = true;
  console.log(`✅🌐 Admin panel running on http://localhost:${envConfig.PORT} (or your Render URL)`);
  if (botLaunchedSuccessfully) console.log('[INDEX] Server listening, bot already launched.');
  else console.log('[INDEX] Server listening, but bot has not confirmed launch yet (or failed).');
}).on('error', (err) => {
  console.error(`❌❌❌ Express server failed to start on port ${envConfig.PORT}: ❌❌❌`);
  console.error("Error Message:", err.message);
  if (err.stack) console.error("Stack Trace:\n", err.stack);
  process.exit(1); // Exit if server can't start
});

console.log('[INDEX] Script execution reached end (event listeners for bot, server, cron, and shutdown should be active if started).');

// === Graceful Shutdown ===
const cleanup = async (signal) => {
  console.log(`[INDEX] ${signal} received, shutting down gracefully...`);
  try {
    if (server && typeof server.close === 'function') {
        console.log('[INDEX] Closing HTTP server...');
        await new Promise(resolve => server.close(resolve)); // Ensure server close completes
        console.log('[INDEX] HTTP server closed.');
    }
    if (bot && typeof bot.stop === 'function') {
        await bot.stop(signal); // Telegraf's stop method
        console.log('[INDEX] Bot stopped.');
    }
    if (pool && typeof pool.end === 'function') {
        await pool.end(); // Close database connections
        console.log('[INDEX] Database pool closed.');
    }
    console.log('[INDEX] Exiting process now.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during graceful shutdown:', err);
    process.exit(1);
  }
};
process.once('SIGINT', () => cleanup('SIGINT'));
process.once('SIGTERM', () => cleanup('SIGTERM'));