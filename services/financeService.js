// services/financeService.js
// Handles logic for expenses and balances.

const { query, pool } = require('../config/db'); // Needs pool for transactions
const { getPeople } = require('./peopleService');

async function addExpenseAndSplit(payerName, amount, description) {
  const client = await pool.connect(); // Get a client from the pool for transaction
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    await client.query(
      'INSERT INTO expenses (payer, amount, description, date) VALUES ($1, $2, $3, $4)',
      [payerName, amount, description, today]
    );

    // Fetch people within the transaction for consistency if needed, or use getPeople()
    const peopleResult = await client.query('SELECT name FROM people');
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
          if (newReverseDebt < 0.001) { // If negligible, delete
            await client.query('DELETE FROM balances WHERE person_from = $1 AND person_to = $2', [creditor, debtor]);
          } else {
            await client.query('UPDATE balances SET amount = $1 WHERE person_from = $2 AND person_to = $3', [newReverseDebt, creditor, debtor]);
          }
          amountToSettle = 0; // Settled
        } else {
          // Creditor's debt is less than the share, clear it and reduce share
          await client.query('DELETE FROM balances WHERE person_from = $1 AND person_to = $2', [creditor, debtor]);
          amountToSettle -= existingReverseDebt;
        }
      }

      if (amountToSettle > 0.001) { // If still something to settle
        await client.query(
          `INSERT INTO balances (person_from, person_to, amount) VALUES ($1, $2, $3)
           ON CONFLICT (person_from, person_to) DO UPDATE SET amount = balances.amount + $3`,
          [debtor, creditor, amountToSettle]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`[FINANCE_SERVICE] Expense of ${amount} by ${payerName} for "${description}" split successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[FINANCE_SERVICE] Error adding expense:', error);
    throw error; // Re-throw to be handled by caller
  } finally {
    client.release();
  }
}

async function getAggregatedBalances() {
  const allPeople = await getPeople(); // Fetches full people objects
  const balancesResult = await query('SELECT person_from, person_to, amount FROM balances WHERE amount > 0.001');
  const allRawBalances = balancesResult.rows;

  const userBalances = {};
  allPeople.forEach(p => {
    userBalances[p.name] = { owes: {}, owed_by: {}, net: 0, chat_id: p.chat_id, telegram_user_id: p.telegram_user_id };
  });

  allRawBalances.forEach(b => {
    // b.person_from owes b.person_to amount b.amount
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

module.exports = { addExpenseAndSplit, getAggregatedBalances };