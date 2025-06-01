// bot/botHandlers.js
// Sets up all bot commands, actions, and text handlers.

const { Markup } = require('telegraf');
const { authenticateBotUser } = require('../middleware/authMiddleware');
const { getPeople } = require('../services/peopleService');
const { getTargetSundayUTC, calculateAssignmentsForCalendarWeek } = require('../services/cleaningService');
const { getAggregatedBalances, addExpenseAndSplit } = require('../services/financeService');
const { query } = require('../config/db');
const { CRON_TIMEZONE } = require('../config/envConfig'); // For date formatting consistency

// Helper to format date consistently for bot messages, using UTC date object
const formatLocaleDateFromUTCDate = (utcDate) => {
    // To display in local time correctly according to CRON_TIMEZONE,
    // this needs more sophisticated timezone handling if CRON_TIMEZONE is not UTC.
    // For simplicity, if date is already UTC midnight, format as UTC.
    // Or, convert to local time of the server for display.
    // Let's stick to en-GB which is common and implies day first.
    return utcDate.toLocaleDateString('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
    });
};


module.exports = function(bot) {
    bot.start(async (ctx) => {
        const telegramUserId = ctx.from.id;
        const firstName = ctx.from.first_name || "User";
        const chatId = ctx.chat.id.toString();
        console.log(`[BOT_HANDLER] /start from UserID: ${telegramUserId}, Name: ${firstName}, ChatID: ${chatId}`);
        try {
            const result = await query('SELECT name FROM people WHERE telegram_user_id = $1', [telegramUserId]);
            if (result.rows.length > 0) {
                const existingUser = result.rows[0];
                await query('UPDATE people SET chat_id = $1 WHERE telegram_user_id = $2', [chatId, telegramUserId]);
                console.log(`[BOT_HANDLER] Updated chat_id for ${existingUser.name}`);
                await ctx.reply(`Welcome back, ${existingUser.name}! Chat registered. Use /help for commands.`);
            } else {
                await ctx.reply(`Hi ${firstName}! Your ID ${telegramUserId} isn't registered. Ask an admin.`);
            }
        } catch (error) { console.error(`[BOT_HANDLER] Error /start:`, error); await ctx.reply("Error processing /start."); }
    });

    // Apply authentication middleware for all subsequent commands/actions
    bot.use(authenticateBotUser);

    bot.command('help', (ctx) => {
        ctx.replyWithMarkdown(
            "*Available Commands:*\n" +
            "/mytask - Show your cleaning tasks for the upcoming week.\n" +
            "/mybalance - Show your financial balances & option to settle debts.\n" +
            "/addexpense - Add a shared expense."
        );
    });

    bot.command('mytask', async (ctx) => {
      const userName = ctx.dbUser.name;
      console.log(`[BOT_HANDLER] /mytask for ${userName}`);
      try {
        const people = await getPeople();
        if (people.length === 0) return ctx.reply("No people in system.");
        
        const upcomingSundayUTC = getTargetSundayUTC(new Date(), 0);
        const wednesdayOfUpcomingWeekUTC = new Date(upcomingSundayUTC);
        wednesdayOfUpcomingWeekUTC.setUTCDate(upcomingSundayUTC.getUTCDate() + 3);

        const assignments = calculateAssignmentsForCalendarWeek(people, upcomingSundayUTC);

        let msg = `Hi ${userName}, tasks for week starting Sunday, ${formatLocaleDateFromUTCDate(upcomingSundayUTC)}:\n`;
        let hasTasks = false;
        for (const task in assignments) {
          if (assignments[task] && assignments[task].includes(userName)) {
            hasTasks = true;
            msg += `- ${task} (Mainly on ${formatLocaleDateFromUTCDate(upcomingSundayUTC)})\n`;
            if (task === 'Toilet') {
              msg += `  Additionally: Toilet again on Wednesday, ${formatLocaleDateFromUTCDate(wednesdayOfUpcomingWeekUTC)}\n`;
            }
          }
        }
        if (!hasTasks) msg = `Hi ${userName}, no specific tasks for week of ${formatLocaleDateFromUTCDate(upcomingSundayUTC)}.`;
        ctx.reply(msg);
      } catch (error) { console.error(`Error /mytask for ${ctx.dbUser.name}:`, error); ctx.reply("Couldn't fetch tasks."); }
    });

    bot.command('mybalance', async (ctx) => {
      // ctx.dbUser is set by the authenticateBotUser middleware
      const userName = ctx.dbUser.name;
      console.log(`[BOT_HANDLER] /mybalance request for ${userName}`);

      try {
        const allBalances = await getAggregatedBalances(); // Fetches balances for all users
        
        const userBalanceData = allBalances[userName]; // Get data for the specific user

        if (!userBalanceData) {
          console.log(`[BOT_HANDLER] No balance information found for ${userName}.`);
          return ctx.reply("Could not find your balance information. This might happen if you're new or have no expenses logged involving you.");
        }

        let reply = `*${userName}'s Balances:*\n\n`; // Added extra newline for readability
        let owesSomeone = false;
        if (userBalanceData.owes && Object.keys(userBalanceData.owes).length > 0) {
          Object.entries(userBalanceData.owes).forEach(([personTo, amount]) => {
            if (amount > 0.001) { // Check if amount is significant
              reply += `➡️ You owe ${personTo}: €${parseFloat(amount).toFixed(2)}\n`;
              owesSomeone = true;
            }
          });
        }
        if (!owesSomeone) {
          reply += "✅ You currently owe nothing to anyone!\n";
        }

        reply += "\n"; // Separator

        let owedBySomeone = false;
        if (userBalanceData.owed_by && Object.keys(userBalanceData.owed_by).length > 0) {
          Object.entries(userBalanceData.owed_by).forEach(([personFrom, amount]) => {
            if (amount > 0.001) { // Check if amount is significant
              reply += `⬅️ ${personFrom} owes you: €${parseFloat(amount).toFixed(2)}\n`;
              owedBySomeone = true;
            }
          });
        }
        if (!owedBySomeone) {
          reply += "✅ No one currently owes you anything!\n";
        }

        reply += `\n*Net Balance: €${parseFloat(userBalanceData.net).toFixed(2)}*\n`;
        if (userBalanceData.net > 0.001) {
          reply += "(Overall, you are owed this much)\n";
        } else if (userBalanceData.net < -0.001) {
          reply += "(Overall, you owe this much)\n";
        } else {
          reply += "(Overall, your balances are settled)\n";
        }

        ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
            Markup.button.callback('🔄 Settle My Debts (Clear what I owe)', 'settle_my_debts')
        ]));

      } catch (error) {
        console.error(`Error in /mybalance for ${userName}:`, error);
        ctx.reply("Sorry, there was an error fetching your balance information. Please try again later.");
      }
    });

    bot.action('settle_my_debts', async (ctx) => {
        if (!ctx.dbUser || !ctx.dbUser.name) return ctx.answerCbQuery("Error: Could not identify user.");
        const userName = ctx.dbUser.name;
        console.log(`[BOT_HANDLER] Action settle_my_debts for ${userName}`);
        const client = await pool.connect(); // Get client from pool exported by db.js
        try {
            await client.query('BEGIN');
            const result = await client.query('DELETE FROM balances WHERE person_from = $1 RETURNING *', [userName]);
            await client.query('COMMIT');
            if (result.rowCount > 0) {
                await ctx.editMessageText(`✅ Your debts to others cleared (${result.rowCount} entries). Money owed to you remains.`);
            } else {
                await ctx.editMessageText(`✅ You had no debts to clear. Money owed to you remains.`);
            }
        } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[SETTLE] Error settling debts for ${userName}:`, error);
        await ctx.answerCbQuery("Error settling debts. Please try again.");
        await ctx.reply("Sorry, there was an error trying to settle your debts.");
    } finally {
        client.release();
    }
    });
    
    const expenseSessions = {}; // Consider moving to a more persistent session store if bot restarts often
    bot.command('addexpense', async (ctx) => {
      expenseSessions[ctx.from.id] = { step: 'amount', username: ctx.dbUser.name };
      ctx.reply('How much was the expense? (e.g., 12.50)');
    });

    bot.on('text', async (ctx) => {
      if (!ctx.dbUser) return; 
      const session = expenseSessions[ctx.from.id];
      if (!session || (ctx.message && ctx.message.text && ctx.message.text.startsWith('/'))) {
          if (session && ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) delete expenseSessions[ctx.from.id];
          return; 
      }
     console.log(`[BOT] Text from ${ctx.dbUser.name} for expense session: ${ctx.message.text}`);
  try {
    if (session.step === 'amount') {
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount <= 0) return ctx.reply('Invalid amount. Positive number please.');
      session.amount = amount;
      session.step = 'description';
      ctx.reply('What was it for? (e.g., Toilet paper)');
    } else if (session.step === 'description') {
      session.description = ctx.message.text;
      await addExpenseAndSplit(session.username, session.amount, session.description);
      ctx.reply(`✅ Expense of €${session.amount.toFixed(2)} for "${session.description}" added and split!`);
      delete expenseSessions[ctx.from.id];
    }
  } catch (error) {
    console.error("Error processing expense (bot text):", error);
    ctx.reply(`Error adding expense: ${error.message}.`);
    delete expenseSessions[ctx.from.id];
  }
    });

    console.log('[BOT_HANDLERS] Bot command, action, and text handlers configured.');
};