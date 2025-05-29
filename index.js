// Add these global error handlers at the very top for debugging
process.on('unhandledRejection', (reason, promise) => { console.error('🚨 Unhandled Rejection:', reason, promise); if (reason && reason.stack) console.error(reason.stack); });
process.on('uncaughtException', (error) => { console.error('🚨 Uncaught Exception:', error); if (error && error.stack) console.error(error.stack); process.exit(1); });

console.log('[DEBUG] Script starting...');
require('dotenv').config();
console.log('[DEBUG] dotenv configured.');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const path = require('path');
const fs = require('fs'); // Needed if you use file-based CA for SSL with pg
const { Pool } = require('pg');
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session); // For storing sessions in PostgreSQL
const bcrypt = require('bcrypt');
console.log('[DEBUG] All main modules required.');

// --- Environment Variable Checks & Setup ---
if (!process.env.BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN missing!'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('❌ FATAL: DATABASE_URL missing!'); process.exit(1); }
const CRON_TIMEZONE = process.env.TIMEZONE || "Europe/Berlin"; // Ensure this is your WG's timezone

const EPOCH_DATE_STRING = process.env.EPOCH_DATE || '2024-01-07'; // Default to a past Sunday
let EPOCH_DATE = new Date(EPOCH_DATE_STRING + 'T00:00:00.000Z'); // Use Z for UTC to make it timezone-agnostic

if (isNaN(EPOCH_DATE.getTime())) {
    console.error(`❌ FATAL: EPOCH_DATE "${EPOCH_DATE_STRING}" is invalid. Please set a valid YYYY-MM-DD in .env. Using default 2024-01-07.`);
    EPOCH_DATE = new Date('2024-01-07T00:00:00.000Z');
}
// Ensure Epoch is a Sunday
if (EPOCH_DATE.getUTCDay() !== 0) { // 0 is Sunday in UTC
    console.error(`❌ FATAL: EPOCH_DATE "${EPOCH_DATE.toISOString()}" (derived from ${EPOCH_DATE_STRING}) is not a Sunday. Please correct it in .env.`);
    // Adjust to previous Sunday for safety, though user should fix .env
    EPOCH_DATE.setUTCDate(EPOCH_DATE.getUTCDate() - EPOCH_DATE.getUTCDay());
    console.warn(`⚠️ Adjusted EPOCH_DATE to previous Sunday (UTC): ${EPOCH_DATE.toISOString()}`);
}
console.log(`[CONFIG] Using EPOCH_DATE (UTC): ${EPOCH_DATE.toISOString()}`);
console.log('[DEBUG] BOT_TOKEN and DATABASE_URL seem to be present.');


const app = express();
const poolOptions = { connectionString: process.env.DATABASE_URL };

// === SSL Configuration for PostgreSQL ===
if (process.env.DB_SSL_ENABLED === 'true') {
  poolOptions.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    // If using a self-signed CA that Node should trust:
    // ca: fs.readFileSync(path.join(__dirname, 'your-ca-certificate.crt')).toString(),
  };
  console.log('[DEBUG] SSL for pg Pool IS CONFIGURED.');
} else {
  console.log('[DEBUG] SSL for pg Pool IS NOT configured.');
}

const pool = new Pool(poolOptions);
const bot = new Telegraf(process.env.BOT_TOKEN);
console.log('[DEBUG] Core objects (app, pool, bot) initialized.');

// --- Session Configuration ---
app.use(session({
    store: new PgSession({
        pool : pool,                // Connection pool
        tableName : 'user_sessions' // Use a direct table name for sessions
        // createtableIfMissing: true // Optional: auto-creates session table if it doesn't exist
    }),
    secret: process.env.SESSION_SECRET || 'your_very_secret_key_for_sessions_123!', // CHANGE THIS IN .ENV
    resave: false,
    saveUninitialized: false, // True if you want to store sessions for unauthenticated users
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
        httpOnly: true
    }
}));
console.log('[DEBUG] Express session configured with connect-pg-simple.');

// --- Express App Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
console.log('[DEBUG] Express app setup complete.');

// --- Authentication Middleware ---
const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next(); // User is authenticated
    }
    res.redirect('/login'); // Not authenticated, redirect to login
};

// --- Database Query Helper ---
async function query(text, params) {
  // console.log(`[DB_QUERY] Attempting: ${text.substring(0,100)}${text.length > 100 ? '...' : ''}`, params || ''); // Verbose
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(text, params);
    return res;
  } catch (error) {
    console.error('❌❌❌ [DB_QUERY_ERROR] Error during database query execution: ❌❌❌');
    console.error(`[DB_QUERY_ERROR] Query: ${text}`);
    console.error(`[DB_QUERY_ERROR] Params: ${JSON.stringify(params)}`);
    console.error(`[DB_QUERY_ERROR] Error details:`, error.message);
    if (error.stack) console.error(`[DB_QUERY_ERROR] Stack: ${error.stack}`);
    throw error;
  } finally {
    if (client) client.release();
  }
}

// --- Core Logic Helper Functions ---
async function getPeople() {
  const result = await query('SELECT name, chat_id, telegram_user_id FROM people ORDER BY id');
  return result.rows;
}

/**
 * Calculates the date of the target Sunday (ensuring it's the start of that day in UTC).
 * @param {Date} referenceDate The date from which to calculate. Defaults to now.
 * @param {number} weekOffset 0 for the upcoming Sunday (or today if Sunday), 1 for the Sunday after, etc.
 * @returns {Date} The calculated Sunday date, set to start of day (UTC).
 */
function getTargetSundayUTC(referenceDate = new Date(), weekOffset = 0) {
    const localDate = new Date(referenceDate); // Start with local time
    const localDayOfWeek = localDate.getDay(); // 0 for Sunday in local time
    
    // Calculate days to add to get to the next local Sunday
    const daysToAdd = (7 - localDayOfWeek) % 7;
    
    const targetLocalDate = new Date(localDate);
    targetLocalDate.setDate(localDate.getDate() + daysToAdd + (weekOffset * 7));
    
    // Normalize to UTC start of that target local Sunday
    const targetUTCDate = new Date(Date.UTC(targetLocalDate.getFullYear(), targetLocalDate.getMonth(), targetLocalDate.getDate()));
    return targetUTCDate;
}


/**
 * Calculates assignments for a specific calendar week based on EPOCH_DATE.
 */
function calculateAssignmentsForCalendarWeek(peopleList, dateForTargetWeek) {
    const numPeople = peopleList.length;
    if (numPeople === 0) return { Kitchen: [], Bathroom: [], Toilet: [] };

    const targetSundayUTC = getTargetSundayUTC(new Date(dateForTargetWeek), 0);

    const weeksPassed = Math.floor((targetSundayUTC.getTime() - EPOCH_DATE.getTime()) / (7 * 24 * 60 * 60 * 1000));
    let cycleOffsetForThisWeek = weeksPassed % numPeople;
    if (cycleOffsetForThisWeek < 0) cycleOffsetForThisWeek += numPeople;
    
    // console.log(`[ASSIGN_CALC] TargetSundayUTC: ${targetSundayUTC.toISOString().split('T')[0]}, WeeksPassed: ${weeksPassed}, NumPeople: ${numPeople}, CycleOffset: ${cycleOffsetForThisWeek}`);

    const assignments = {};
    const rotatedPeople = [...peopleList.slice(cycleOffsetForThisWeek), ...peopleList.slice(0, cycleOffsetForThisWeek)];

    if (numPeople === 3) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[1].name];
        assignments.Toilet = [rotatedPeople[2].name];
    } else if (numPeople === 4) {
        assignments.Kitchen = [rotatedPeople[0].name, rotatedPeople[1].name];
        assignments.Bathroom = [rotatedPeople[2].name];
        assignments.Toilet = [rotatedPeople[3].name];
    } else if (numPeople === 2) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[1].name];
        assignments.Toilet = [rotatedPeople[0].name];
    } else if (numPeople === 1) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[0].name];
        assignments.Toilet = [rotatedPeople[0].name];
    } else {
        assignments.Kitchen = []; assignments.Bathroom = []; assignments.Toilet = [];
    }
    return assignments;
}

// --- Admin Panel Data Function ---
async function getUpcomingCleaningSchedule(numWeeks = 4) {
  const people = await getPeople();
  const schedule = [];
  if (people.length === 0) return schedule;

  const today = new Date();
  for (let i = 0; i < numWeeks; i++) {
    const targetSundayUTC = getTargetSundayUTC(today, i);
    const assignments = calculateAssignmentsForCalendarWeek(people, targetSundayUTC);
    
    // For display, convert UTC date back to a simple YYYY-MM-DD string
    const displayDate = targetSundayUTC.toISOString().split('T')[0];

    schedule.push({
      date: displayDate,
      kitchen: (assignments.Kitchen || []).join(' & ') || 'N/A',
      bathroom: (assignments.Bathroom || []).join(' & ') || 'N/A',
      toilet: (assignments.Toilet || []).join(' & ') || 'N/A',
    });
  }
  return schedule;
}

// --- Financial Logic ---
async function addExpenseAndSplit(payerName, amount, description) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    await client.query(
      'INSERT INTO expenses (payer, amount, description, date) VALUES ($1, $2, $3, $4)',
      [payerName, amount, description, today]
    );

    const peopleResult = await query('SELECT name FROM people');
    const allPeople = peopleResult.rows;
    if (allPeople.length === 0) {
      await client.query('ROLLBACK');
      throw new Error("No people in the system to split expenses with.");
    }
    const share = amount / allPeople.length;

    for (const person of allPeople) {
      if (person.name === payerName) continue;
      let debtor = person.name;
      let creditor = payerName;
      let amountToSettle = share;

      const reverseBalanceResult = await client.query(
        'SELECT amount FROM balances WHERE person_from = $1 AND person_to = $2',
        [creditor, debtor]
      );
      if (reverseBalanceResult.rows.length > 0) {
        let existingReverseDebt = parseFloat(reverseBalanceResult.rows[0].amount);
        if (existingReverseDebt >= amountToSettle) {
          const newReverseDebt = existingReverseDebt - amountToSettle;
          if (newReverseDebt < 0.001) {
            await client.query('DELETE FROM balances WHERE person_from = $1 AND person_to = $2', [creditor, debtor]);
          } else {
            await client.query('UPDATE balances SET amount = $1 WHERE person_from = $2 AND person_to = $3', [newReverseDebt, creditor, debtor]);
          }
          amountToSettle = 0;
        } else {
          await client.query('DELETE FROM balances WHERE person_from = $1 AND person_to = $2', [creditor, debtor]);
          amountToSettle -= existingReverseDebt;
        }
      }
      if (amountToSettle > 0.001) {
        await client.query(
          `INSERT INTO balances (person_from, person_to, amount) VALUES ($1, $2, $3)
           ON CONFLICT (person_from, person_to) DO UPDATE SET amount = balances.amount + $3`,
          [debtor, creditor, amountToSettle]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`[FINANCE] Expense of ${amount} by ${payerName} for "${description}" split successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[FINANCE] Error adding expense:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function getAggregatedBalances() {
  const people = await getPeople();
  const balancesResult = await query('SELECT person_from, person_to, amount FROM balances WHERE amount > 0.001');
  const allBalances = balancesResult.rows;

  const userBalances = {};
  people.forEach(p => {
    userBalances[p.name] = { owes: {}, owed_by: {}, net: 0, chat_id: p.chat_id, telegram_user_id: p.telegram_user_id };
  });

  allBalances.forEach(b => {
    if (userBalances[b.person_from]) {
      userBalances[b.person_from].owes[b.person_to] = (userBalances[b.person_from].owes[b.person_to] || 0) + b.amount;
      userBalances[b.person_from].net -= b.amount;
    }
    if (userBalances[b.person_to]) {
      userBalances[b.person_to].owed_by[b.person_from] = (userBalances[b.person_to].owed_by[b.person_from] || 0) + b.amount;
      userBalances[b.person_to].net += b.amount;
    }
  });
  return userBalances;
}

// --- Middleware for Bot User Authentication ---
const authenticateBotUser = async (ctx, next) => {
    const telegramUserId = ctx.from.id;
    try {
        const result = await query('SELECT name, chat_id, telegram_user_id FROM people WHERE telegram_user_id = $1', [telegramUserId]);
        if (result.rows.length > 0) {
            ctx.dbUser = result.rows[0];
            return next();
        } else {
            await ctx.reply("Sorry, you are not authorized to use this bot. Please ask an admin to add your Telegram User ID to the database.");
            console.log(`[AUTH_BOT] Unauthorized bot access attempt by Telegram User ID: ${telegramUserId} (Name: ${ctx.from.first_name || 'Unknown'})`);
            return;
        }
    } catch (error) {
        console.error("[AUTH_BOT] Error during bot user authentication:", error);
        await ctx.reply("An error occurred during authentication. Please try again later.");
        return;
    }
};

// --- Express Routes ---
// Login Routes
app.get('/login', (req, res) => {
    // If user is already logged in, redirect to dashboard
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: req.session.loginError }); // Pass error message if any
    delete req.session.loginError; // Clear error after displaying
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[AUTH_WEB] Login attempt for username: ${username}`);
    try {
        const result = await query('SELECT id, name, hashed_password FROM people WHERE name = $1 AND is_admin = TRUE', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.hashed_password);
            if (match) {
                req.session.user = { id: user.id, name: user.name }; // Store user info in session
                console.log(`[AUTH_WEB] User ${user.name} logged in successfully.`);
                return res.redirect('/');
            }
        }
        console.log(`[AUTH_WEB] Login failed for username: ${username} (invalid credentials or not admin).`);
        req.session.loginError = 'Invalid username or password, or not an admin.';
        res.redirect('/login');
    } catch (error) {
        console.error('[AUTH_WEB] Error during login:', error);
        req.session.loginError = 'An error occurred during login. Please try again.';
        res.redirect('/login');
    }
});

app.get('/logout', (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('[AUTH_WEB] Error destroying session:', err);
            return next(err);
        }
        console.log('[AUTH_WEB] User logged out.');
        res.redirect('/login');
    });
});

// Protected Admin Routes
app.get('/', ensureAuthenticated, async (req, res) => {
  console.log('[DEBUG] GET / route by admin');
  try {
    const upcomingSchedule = await getUpcomingCleaningSchedule(4);
    const expensesResult = await query('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 4');
    const balancesData = await getAggregatedBalances();
    const peopleList = await getPeople();
    const peopleNames = peopleList.map(p => p.name);

    res.render('index', {
      pageTitle: 'WG Dashboard',
      user: req.session.user,
      cleaningSchedule: upcomingSchedule,
      expenses: expensesResult.rows,
      balances: balancesData,
      peopleNames: peopleNames
    });
  } catch (err) {
    console.error('❌ Error in GET / route:', err);
    res.status(500).send('Error loading dashboard. Check logs.');
  }
});

app.get('/expenses', ensureAuthenticated, async (req, res) => {
  console.log('[DEBUG] GET /expenses route by admin');
  try {
    const expensesResult = await query('SELECT * FROM expenses ORDER BY date DESC, id DESC');
    res.render('all_expenses', {
      pageTitle: 'All Expenses',
      user: req.session.user,
      expenses: expensesResult.rows
    });
  } catch (err) {
    console.error('Error in GET /expenses route:', err);
    res.status(500).send('Error loading expenses. Check logs.');
   }
});

app.post('/add-expense', ensureAuthenticated, async (req, res) => {
  const { payer, amount, description } = req.body;
  console.log(`[DEBUG] POST /add-expense: Payer=${payer}, Amount=${amount}, Desc=${description}`);
  try {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error("Invalid amount specified.");
    }
    await addExpenseAndSplit(payer, numericAmount, description);
    res.redirect('/');
  } catch (error) {
    console.error("Failed to add expense from web:", error);
    res.status(400).send(`Error adding expense: ${error.message}. <a href="/">Go Back</a>`);
  }
});

// --- Telegraf Bot Logic ---
bot.start(async (ctx) => {
    const telegramUserId = ctx.from.id;
    const firstName = ctx.from.first_name || "User"; // Use a default if first_name is not available
    const chatId = ctx.chat.id.toString();
    console.log(`[BOT] /start received from Telegram User ID: ${telegramUserId}, Name: ${firstName}, ChatID: ${chatId}`);
    try {
        // Check if this telegram_user_id is already in our people table
        const result = await query('SELECT name FROM people WHERE telegram_user_id = $1', [telegramUserId]);
        if (result.rows.length > 0) {
            // User exists, update their chat_id for notifications
            const existingUser = result.rows[0];
            await query('UPDATE people SET chat_id = $1 WHERE telegram_user_id = $2', [chatId, telegramUserId]);
            console.log(`[BOT] Updated chat_id for existing user ${existingUser.name} (Telegram ID: ${telegramUserId})`);
            await ctx.reply(`Welcome back, ${existingUser.name}! Your chat has been registered for notifications. Use /help for available commands.`);
        } else {
            // User does not exist in the people table
            console.log(`[BOT] Unknown user ${firstName} (Telegram User ID: ${telegramUserId}) tried to /start. Informing them to contact admin.`);
            await ctx.reply(`Hi ${firstName}! Your Telegram User ID is ${telegramUserId}. To use this bot, an admin must first add your Telegram User ID to the system. Please provide this ID to your admin.`);
        }
    } catch (error) {
        console.error(`[BOT] Error in /start for user ${telegramUserId}:`, error);
        await ctx.reply("There was an error processing your /start command. Please try again or contact an admin if the issue persists.");
    }
});

bot.use(authenticateBotUser); // Authenticate all subsequent interactions

bot.command('help', (ctx) => {
    ctx.replyWithMarkdown(
        "*Available Commands:*\n" +
        "/mytask - Show your cleaning tasks for the upcoming week.\n" +
        "/mybalance - Show your current financial balances and option to settle debts.\n" +
        "/addexpense - Start a conversation to add a shared expense."
    );
});

// Helper to format date consistently for bot messages
const formatLocaleDate = (date) => date.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone: CRON_TIMEZONE});


bot.command('mytask', async (ctx) => {
  const userName = ctx.dbUser.name;
  console.log(`[BOT] /mytask for ${userName}`);
  try {
    const people = await getPeople();
    if (people.length === 0) return ctx.reply("No people registered in the system.");
    
    const upcomingSunday = getTargetSundayUTC(new Date(), 0);
    const wednesdayOfUpcomingWeek = new Date(upcomingSunday);
    wednesdayOfUpcomingWeek.setUTCDate(upcomingSunday.getUTCDate() + 3);

    const assignments = calculateAssignmentsForCalendarWeek(people, upcomingSunday);

    let msg = `Hi ${userName}, tasks for week starting Sunday, ${formatLocaleDate(upcomingSunday)}:\n`;
    let hasTasks = false;
    for (const task in assignments) {
      if (assignments[task] && assignments[task].includes(userName)) {
        hasTasks = true;
        msg += `- ${task} (Mainly on ${formatLocaleDate(upcomingSunday)})\n`;
        if (task === 'Toilet') {
          msg += `  Additionally: Toilet again on Wednesday, ${formatLocaleDate(wednesdayOfUpcomingWeek)}\n`;
        }
      }
    }
    if (!hasTasks) msg = `Hi ${userName}, no specific tasks for week of ${formatLocaleDate(upcomingSunday)}.`;
    ctx.reply(msg);
  } catch (error) { console.error("Error in /mytask for " + (ctx.dbUser ? ctx.dbUser.name : 'unknown user'), error); ctx.reply("Sorry, couldn't fetch your tasks."); }
});

bot.command('mybalance', async (ctx) => {
  const userName = ctx.dbUser.name;
  console.log(`[BOT] /mybalance for ${userName}`);
  try {
    const allBalances = await getAggregatedBalances();
    const userBalanceInfo = allBalances[userName];
    if (!userBalanceInfo) return ctx.reply("Could not find your balance information.");

    let reply = `*${userName}'s Balances:*\n`;
    let owesSomeone = false;
    Object.entries(userBalanceInfo.owes).forEach(([personTo, amount]) => {
        if (amount > 0.001) { reply += `➡️ You owe ${personTo}: €${amount.toFixed(2)}\n`; owesSomeone = true; }
    });
    if (!owesSomeone) reply += "✅ You owe nothing to anyone!\n";
    reply += "\n";
    let owedBySomeone = false;
    Object.entries(userBalanceInfo.owed_by).forEach(([personFrom, amount]) => {
        if (amount > 0.001) { reply += `⬅️ ${personFrom} owes you: €${amount.toFixed(2)}\n`; owedBySomeone = true; }
    });
    if (!owedBySomeone) reply += "✅ No one owes you anything!\n";
    reply += `\n*Net Balance: €${userBalanceInfo.net.toFixed(2)}*\n`;
    if (userBalanceInfo.net > 0.001) reply += "(You are owed this much overall)\n";
    else if (userBalanceInfo.net < -0.001) reply += "(You owe this much overall)\n";
    else reply += "(Your balances are settled overall)\n";

    ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
        Markup.button.callback('🔄 Settle My Debts (Clear what I owe)', 'settle_my_debts')
    ]));
  } catch (error) { console.error("Error in /mybalance for " + userName, error); ctx.reply("Sorry, couldn't fetch your balance."); }
});

bot.action('settle_my_debts', async (ctx) => {
    if (!ctx.dbUser || !ctx.dbUser.name) return ctx.answerCbQuery("Error: Could not identify user.");
    const userName = ctx.dbUser.name;
    console.log(`[BOT] Action settle_my_debts for ${userName}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM balances WHERE person_from = $1 RETURNING *', [userName]);
        await client.query('COMMIT');
        if (result.rowCount > 0) {
            await ctx.editMessageText(`✅ Your outstanding debts to others have been marked as settled (${result.rowCount} entries cleared). Money owed to you by others remains unchanged.`);
            console.log(`[SETTLE] ${userName} settled their debts to others. ${result.rowCount} balance entries removed.`);
        } else {
            await ctx.editMessageText(`✅ You had no outstanding debts to mark as settled. Money owed to you by others remains unchanged.`);
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

const expenseSessions = {};
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

// --- Scheduled Notifications (Cron Jobs) ---
async function sendCleaningAssignments(forceSend = false) {
  console.log('[CRON] Running weekly cleaning assignment job...');
  const people = await getPeople(); // Ensure this fetches telegram_user_id
  if (people.length === 0) {
    console.log('[CRON] No people registered for assignments. Skipping.');
    return;
  }

  const todayIsSundayUTC = getTargetSundayUTC(new Date(), 0); // Using the corrected date function
  const assignmentsForThisWeek = calculateAssignmentsForCalendarWeek(people, todayIsSundayUTC);
  const wednesdayOfThisWeekUTC = new Date(todayIsSundayUTC);
  wednesdayOfThisWeekUTC.setUTCDate(todayIsSundayUTC.getUTCDate() + 3);
  const formatDate = (date) => date.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC' });


  let messagesSent = 0;
  for (const person of people) {
    if (!person.chat_id) {
      console.log(`[CRON] Skipping notification for ${person.name}, no chat_id found.`);
      continue;
    }
    let personTasks = [];
    for (const task in assignmentsForThisWeek) {
      if (assignmentsForThisWeek[task] && assignmentsForThisWeek[task].includes(person.name)) {
        personTasks.push(task);
      }
    }

    if (personTasks.length > 0 || forceSend) {
      let message = `Hi ${person.name}! Your cleaning tasks for the week starting Sunday, ${formatDate(todayIsSundayUTC)}:\n`;
      if (personTasks.length === 0 && forceSend) {
        message = `Hi ${person.name}, just a weekly ping! No specific large tasks assigned this week.`;
      } else {
        personTasks.forEach(task => {
            message += `- ${task} (Mainly on ${formatDate(todayIsSundayUTC)})\n`;
            if (task === 'Toilet') {
                message += `  (Remember, also on Wednesday, ${formatDate(wednesdayOfThisWeekUTC)})\n`;
            }
        });
      }
      try {
        await bot.telegram.sendMessage(person.chat_id, message);
        messagesSent++;
        console.log(`[CRON] Successfully sent weekly task to ${person.name} (Chat ID: ${person.chat_id})`);
      } catch (error) { // Enhanced error handling
        console.error(`[CRON] ❌ Failed to send weekly task to ${person.name} (Chat ID: ${person.chat_id}, Telegram User ID: ${person.telegram_user_id})`);
        console.error(`[CRON] Error Message: ${error.message}`);
        if (error.response && error.response.description) {
            console.error(`[CRON] Telegram API Error Description: ${error.response.description}`);
        }
        if (error.code) { // Telegraf often includes a numeric error code
            console.error(`[CRON] Telegram API Error Code: ${error.code}`);
            if (error.code === 403) { // HTTP 403 Forbidden - often due to bot blocked or user not found
                console.warn(`[CRON] Received 403 error for ${person.name}. This might mean the bot was blocked or chat is inaccessible.`);
                // Optionally, clear the chat_id so we don't keep trying
                if (person.telegram_user_id) {
                    try {
                        await query('UPDATE people SET chat_id = NULL WHERE telegram_user_id = $1', [person.telegram_user_id]);
                        console.log(`[CRON] Cleared chat_id for ${person.name} (TID: ${person.telegram_user_id}) due to 403 error. They will need to /start again.`);
                    } catch (dbError) {
                        console.error(`[CRON] Failed to clear chat_id for ${person.name} after 403 error:`, dbError);
                    }
                } else {
                     console.warn(`[CRON] Cannot clear chat_id for ${person.name} as telegram_user_id was not available in the person object from getPeople().`);
                }
            }
        }
      }
    }
  }
  console.log(`[CRON] Sent ${messagesSent} weekly assignment messages. Rotation is calendar-based, no DB offset update needed for this logic.`);
  // No offset update here as per new calendar-based logic
}

async function sendWednesdayToiletReminders() {
  console.log('[CRON_WED] Running Wednesday toilet reminder job...');
  const people = await getPeople(); // Ensure this fetches telegram_user_id
  if (people.length === 0) {
    console.log('[CRON_WED] No people registered. Skipping reminders.');
    return;
  }

  const todayIsWednesdayUTC = new Date(); // Cron runs on Wednesday
  todayIsWednesdayUTC.setUTCHours(0,0,0,0); // Normalize to UTC start of day for consistent date operations
  const formatDate = (date) => date.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC'});

  const assignmentsForCurrentWeek = calculateAssignmentsForCalendarWeek(people, todayIsWednesdayUTC);

  if (assignmentsForCurrentWeek.Toilet && assignmentsForCurrentWeek.Toilet.length > 0) {
    assignmentsForCurrentWeek.Toilet.forEach(async (personName) => {
      const personToNotify = people.find(p => p.name === personName && p.chat_id);
      if (personToNotify) {
        try {
          await bot.telegram.sendMessage(personToNotify.chat_id, `🧹 Reminder: Today, ${formatDate(todayIsWednesdayUTC)}, is your mid-week toilet cleaning day!`);
          console.log(`[CRON_WED] Sent Wednesday toilet reminder to ${personName}.`);
        } catch (error) { // Enhanced error handling
          console.error(`[CRON_WED] ❌ Failed to send Wednesday reminder to ${personName} (Chat ID: ${personToNotify.chat_id}, Telegram User ID: ${personToNotify.telegram_user_id})`);
          console.error(`[CRON_WED] Error Message: ${error.message}`);
          if (error.response && error.response.description) {
              console.error(`[CRON_WED] Telegram API Error Description: ${error.response.description}`);
          }
          if (error.code) {
              console.error(`[CRON_WED] Telegram API Error Code: ${error.code}`);
              if (error.code === 403) {
                  console.warn(`[CRON_WED] Received 403 error for ${personToNotify.name}. Bot might be blocked or chat inaccessible. Clearing chat_id.`);
                  if (personToNotify.telegram_user_id) {
                      try {
                          await query('UPDATE people SET chat_id = NULL WHERE telegram_user_id = $1', [personToNotify.telegram_user_id]);
                          console.log(`[CRON_WED] Cleared chat_id for ${personToNotify.name} (TID: ${personToNotify.telegram_user_id}) due to 403 error.`);
                      } catch (dbError) {
                          console.error(`[CRON_WED] Failed to clear chat_id for ${personToNotify.name} after 403 error:`, dbError);
                      }
                  } else {
                       console.warn(`[CRON_WED] Cannot clear chat_id for ${personToNotify.name} as telegram_user_id was not available.`);
                  }
              }
          }
        }
      } else {
        // This case should ideally not happen if personName came from assignments and people list is up-to-date
        console.warn(`[CRON_WED] Could not find person object or chat_id for ${personName} assigned to Toilet.`);
      }
    });
  } else {
    console.log('[CRON_WED] No one assigned to Toilet this week based on calendar calculation.');
  }
}

cron.schedule('0 10 * * 0', () => sendCleaningAssignments(), { timezone: CRON_TIMEZONE });
cron.schedule('0 10 * * 3', () => sendWednesdayToiletReminders(), { timezone: CRON_TIMEZONE });
console.log(`[SETUP] Cron jobs scheduled in timezone: ${CRON_TIMEZONE}. EPOCH: ${EPOCH_DATE_STRING}`);

// --- Bot Launch and Server Listen ---
const PORT = process.env.PORT || 3000;
console.log(`[DEBUG] Preparing to launch bot and start Express server on port ${PORT}...`);
let botLaunchedSuccessfully = false;
let serverListeningSuccessfully = false;

console.log('[DEBUG] Attempting bot.launch()...');
bot.launch()
  .then(() => {
    botLaunchedSuccessfully = true;
    console.log('✅🤖 Bot started successfully!');
    if (serverListeningSuccessfully) console.log('[DEBUG] Bot launched, server already listening.');
  })
  .catch(err => {
    console.error("❌❌❌ Telegraf Bot failed to launch: ❌❌❌");
    console.error("Error Message:", err.message);
    if (err.stack) console.error("Stack Trace:\n", err.stack);
  });

console.log('[DEBUG] Attempting app.listen()...');
const server = app.listen(PORT, () => {
  serverListeningSuccessfully = true;
  console.log(`✅🌐 Admin panel running on http://localhost:${PORT}`);
  if (botLaunchedSuccessfully) console.log('[DEBUG] Server listening, bot already launched.');
  else console.log('[DEBUG] Server listening, bot not confirmed launch yet (or failed).');
}).on('error', (err) => {
  console.error(`❌❌❌ Express server failed to start on port ${PORT}: ❌❌❌`);
  console.error("Error Message:", err.message);
  if (err.stack) console.error("Stack Trace:\n", err.stack);
  process.exit(1);
});

console.log('[DEBUG] Script execution reached end (listeners should be active).');

// === Graceful Shutdown ===
const cleanup = async (signal) => {
  console.log(`[DEBUG] ${signal} received, shutting down gracefully...`);
  try {
    if (bot && typeof bot.stop === 'function') await bot.stop(signal); console.log('[DEBUG] Bot stopped.');
    if (pool && typeof pool.end === 'function') await pool.end(); console.log('[DEBUG] DB pool closed.');
    console.log('[DEBUG] Exiting process now.');
    process.exit(0);
  } catch (err) { console.error('❌ Error during graceful shutdown:', err); process.exit(1); }
};
process.once('SIGINT', () => cleanup('SIGINT'));
process.once('SIGTERM', () => cleanup('SIGTERM'));