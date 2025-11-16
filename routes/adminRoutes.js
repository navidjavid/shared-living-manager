// routes/adminRoutes.js
// Handles protected admin panel routes.

const express = require('express');
const { getUpcomingCleaningSchedule } = require('../services/cleaningService');
const { getAggregatedBalances, addExpenseAndSplit, settleDebts } = require('../services/financeService');
const { getPeople } = require('../services/peopleService');
const { query } = require('../config/db'); // For direct queries like recent expenses
const router = express.Router();

// Note: ensureAuthenticated middleware will be applied to this router in index.js

router.get('/', async (req, res) => {
  console.log(`[ADMIN_ROUTES] GET / route by authenticated user: ${req.session.user.name}`);
  try {
    const upcomingSchedule = await getUpcomingCleaningSchedule(4);
    const expensesResult = await query('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 4');
    const balancesData = await getAggregatedBalances();
    const peopleList = await getPeople(); // To get names for the payer dropdown
    const peopleNames = peopleList.map(p => p.name);

    res.render('index', {
      pageTitle: 'WG Dashboard',
      user: req.session.user, // Pass user to views for potential display
      cleaningSchedule: upcomingSchedule,
      expenses: expensesResult.rows,
      balances: balancesData,
      peopleNames: peopleNames // For the payer dropdown in add expense form
    });
  } catch (err) {
    console.error('❌ Error in GET / admin route:', err);
    res.status(500).send('Error loading dashboard. Please check server logs.');
  }
});

router.get('/expenses', async (req, res) => {
  console.log(`[ADMIN_ROUTES] GET /expenses route by authenticated user: ${req.session.user.name}`);
  try {
    const expensesResult = await query('SELECT * FROM expenses ORDER BY date DESC, id DESC');
    res.render('all_expenses', {
      pageTitle: 'All Expenses',
      user: req.session.user,
      expenses: expensesResult.rows
    });
  } catch (err) {
    console.error('Error in GET /expenses admin route:', err);
    res.status(500).send('Error loading all expenses. Check server logs.');
   }
});

router.post('/add-expense', async (req, res) => {
  const { payer, amount, description } = req.body;
  console.log(`[ADMIN_ROUTES] POST /add-expense: Payer=${payer}, Amount=${amount}, Desc=${description}`);
  try {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error("Invalid amount specified. Must be a positive number.");
    }
    await addExpenseAndSplit(payer, numericAmount, description);
    res.redirect('/');
  } catch (error) {
    console.error("Failed to add expense from web admin panel:", error);
    // Ideally, redirect back with an error message
    // For now, sending a simple error page or message
    res.status(400).send(`Error adding expense: ${error.message}. <a href="/">Go Back</a>`);
  }
});
router.post('/settle-debts', async (req, res) => {
    const userName = req.session.user.name; // Get the name of the logged-in user (admin)
    console.log(`[ADMIN_ROUTES] POST /settle-debts: User=${userName} initiating debt settlement.`);
    try {
        const clearedCount = await settleDebts(userName);
        // Redirect back to the dashboard after settlement
        res.redirect(`/?message=Debts+Settled!+${clearedCount}+entries+cleared.`);
    } catch (error) {
        console.error(`Failed to settle debts for ${userName} from web admin panel:`, error);
        // Send a temporary error response
        res.status(400).send(`Error settling debts: ${error.message}. <a href="/">Go Back</a>`);
    }
});

module.exports = router;