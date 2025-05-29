// config/envConfig.js
// Loads and exports all necessary environment variables.

require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const CRON_TIMEZONE = process.env.TIMEZONE || "Europe/Berlin";
const EPOCH_DATE_STRING = process.env.EPOCH_DATE || '2024-01-07'; // Must be a Sunday in YYYY-MM-DD

const DB_SSL_ENABLED = process.env.DB_SSL_ENABLED === 'true';
// For Supabase pooler, 'false' was needed for Render. Adjust if your setup differs.
const DB_SSL_REJECT_UNAUTHORIZED = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'; 

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;

// Validate critical environment variables
if (!BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN missing from .env!'); process.exit(1); }
if (!DATABASE_URL) { console.error('❌ FATAL: DATABASE_URL missing from .env!'); process.exit(1); }
if (!SESSION_SECRET) { console.error('❌ FATAL: SESSION_SECRET missing from .env! Please set a long random string.'); process.exit(1); }

let EPOCH_DATE = new Date(EPOCH_DATE_STRING + 'T00:00:00.000Z'); // Use UTC for epoch
if (isNaN(EPOCH_DATE.getTime())) {
    console.error(`❌ FATAL: EPOCH_DATE "${EPOCH_DATE_STRING}" is invalid. Using default 2024-01-07.`);
    EPOCH_DATE = new Date('2024-01-07T00:00:00.000Z');
}
if (EPOCH_DATE.getUTCDay() !== 0) { // 0 is Sunday in UTC
    console.error(`❌ FATAL: EPOCH_DATE "${EPOCH_DATE.toISOString()}" (from ${EPOCH_DATE_STRING}) is not a Sunday.`);
    // Adjust to previous Sunday for safety, but the .env file should be corrected.
    EPOCH_DATE.setUTCDate(EPOCH_DATE.getUTCDate() - EPOCH_DATE.getUTCDay());
    console.warn(`⚠️ Adjusted EPOCH_DATE to previous Sunday (UTC): ${EPOCH_DATE.toISOString()}`);
}
console.log(`[CONFIG] Using EPOCH_DATE (UTC): ${EPOCH_DATE.toISOString()}`);

module.exports = {
    BOT_TOKEN,
    DATABASE_URL,
    SESSION_SECRET,
    CRON_TIMEZONE,
    EPOCH_DATE,
    DB_SSL_ENABLED,
    DB_SSL_REJECT_UNAUTHORIZED,
    NODE_ENV,
    PORT
};