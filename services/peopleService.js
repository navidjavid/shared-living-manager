// services/peopleService.js
// Logic related to fetching people data.

const { query } = require('../config/db');

async function getPeople() {
  const result = await query('SELECT id, name, chat_id, telegram_user_id FROM people ORDER BY id');
  return result.rows;
}

module.exports = { getPeople };