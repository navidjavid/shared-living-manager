// middleware/authMiddleware.js
// Defines authentication middleware for web routes and bot commands.

const { query } = require('../config/db');

const ensureAuthenticated = (req, res, next) => {
  console.log('[WEB_AUTH_MIDDLEWARE] Path:', req.path);
    console.log('[WEB_AUTH_MIDDLEWARE] Session exists:', !!req.session);
    if (req.session) {
        console.log('[WEB_AUTH_MIDDLEWARE] Session ID on check:', req.session.id); // Log session ID
        console.log('[WEB_AUTH_MIDDLEWARE] Session user on check:', req.session.user);
    }

    if (req.session && req.session.user && req.session.user.name) {
        console.log('[WEB_AUTH_MIDDLEWARE] User IS authenticated:', req.session.user.name);
        return next();
    } else {
        console.log('[WEB_AUTH_MIDDLEWARE] User IS NOT authenticated. Redirecting to /login.');
        // req.session.loginError = 'Please log in to access this page.'; // Avoid setting error here if it's just a normal redirect
        res.redirect('/login');
    }
};

const authenticateBotUser = async (ctx, next) => {
    const telegramUserId = ctx.from.id;
    try {
        const result = await query('SELECT id, name, chat_id, telegram_user_id FROM people WHERE telegram_user_id = $1', [telegramUserId]);
        if (result.rows.length > 0) {
            ctx.dbUser = result.rows[0]; // Attach user info to context for handlers
            return next();
        } else {
            await ctx.reply("Sorry, you are not authorized to use this bot. Please ask an admin to add your Telegram User ID to the database.");
            console.log(`[BOT_AUTH_MIDDLEWARE] Unauthorized access attempt by Telegram User ID: ${telegramUserId} (Name: ${ctx.from.first_name || 'Unknown'})`);
            return; // Stop further processing
        }
    } catch (error) {
        console.error("[BOT_AUTH_MIDDLEWARE] Error during bot user authentication:", error);
        await ctx.reply("An authentication error occurred. Please try again later.");
        return;
    }
};

module.exports = { ensureAuthenticated, authenticateBotUser };