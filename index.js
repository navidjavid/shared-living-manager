// index.js (Cleaned Version)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // Try IPv4 first for DNS lookups

// Global error handlers - these are good to keep
process.on('unhandledRejection', (reason, promise) => { console.error('🚨 Unhandled Rejection:', reason, promise); if (reason && reason.stack) console.error(reason.stack); });
process.on('uncaughtException', (error) => { console.error('🚨 Uncaught Exception:', error); if (error && error.stack) console.error(error.stack); process.exit(1); });

console.log('Application starting...'); // General startup log

const envConfig = require('./config/envConfig');
const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./config/db');
const bot = require('./bot/botInstance');
const setupBotHandlers = require('./bot/botHandlers');
const { ensureAuthenticated } = require('./middleware/authMiddleware');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { startCronJobs } = require('./jobs/cronJobs');

const app = express();

// Trust the first proxy (Render's reverse proxy)
app.set('trust proxy', 1);
console.log('Trust proxy set.');

// --- Session Configuration ---
app.use(session({
    store: new PgSession({
        pool : pool,
        tableName : 'user_sessions',
        createTableIfMissing: true
    }),
    secret: envConfig.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: envConfig.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'Lax'
    }
}));
console.log('Express session configured.');

// --- Express App Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
console.log('Express core middleware and view engine setup complete.');

// --- Routes ---
app.use('/', authRoutes); // Login, logout routes
app.use('/', ensureAuthenticated, adminRoutes); // Protected admin panel routes
console.log('Web routes configured.');

// --- Setup Bot Handlers ---
setupBotHandlers(bot);

// --- Start Cron Jobs ---
startCronJobs();


// --- Bot Launch and Server Listen ---
console.log(`Preparing to launch bot and start Express server on port ${envConfig.PORT}...`);
let botLaunchedSuccessfully = false;
let serverListeningSuccessfully = false;

bot.launch()
  .then(() => {
    botLaunchedSuccessfully = true;
    console.log('✅🤖 Bot started successfully!');
    if (serverListeningSuccessfully) console.log('Bot launched, server was already listening.');
  })
  .catch(err => {
    console.error("❌ Telegraf Bot failed to launch:", err.message);
    if (err.stack) console.error("Stack Trace:\n", err.stack);
  });

const server = app.listen(envConfig.PORT, () => {
  serverListeningSuccessfully = true;
  console.log(`✅🌐 Admin panel running on http://localhost:${envConfig.PORT} (or your Render URL)`);
  if (botLaunchedSuccessfully) console.log('Server listening, bot was already launched.');
  else console.log('Server listening, but bot has not confirmed launch yet (or failed).');
}).on('error', (err) => {
  console.error(`❌ Express server failed to start on port ${envConfig.PORT}:`, err.message);
  if (err.stack) console.error("Stack Trace:\n", err.stack);
  process.exit(1);
});

// === Graceful Shutdown ===
const cleanup = async (signal) => {
  console.log(`${signal} received, shutting down gracefully...`);
  try {
    if (server && typeof server.close === 'function') {
        console.log('Closing HTTP server...');
        await new Promise(resolve => server.close(err => {
            if (err) console.error("Error closing HTTP server:", err);
            else console.log('HTTP server closed.');
            resolve();
        }));
    }
    if (bot && typeof bot.stop === 'function') {
        await bot.stop(signal);
        console.log('Bot stopped.');
    }
    if (pool && typeof pool.end === 'function') {
        await pool.end();
        console.log('Database pool closed.');
    }
    console.log('Exiting process now.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during graceful shutdown:', err);
    process.exit(1);
  }
};
process.once('SIGINT', () => cleanup('SIGINT'));
process.once('SIGTERM', () => cleanup('SIGTERM'));