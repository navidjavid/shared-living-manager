// bot/botInstance.js
// Initializes and exports the Telegraf bot instance.

const { Telegraf } = require('telegraf');
const { BOT_TOKEN } = require('../config/envConfig');

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is undefined in botInstance.js. Check envConfig.');
    // Optionally throw an error or exit if bot is critical
    // throw new Error("BOT_TOKEN is not configured.");
}

const bot = new Telegraf(BOT_TOKEN);

console.log('[BOT_INSTANCE] Telegraf bot object created.');

module.exports = bot;