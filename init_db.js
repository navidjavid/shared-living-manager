const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./schedule.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    chat_id TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payer TEXT,
    amount REAL,
    description TEXT,
    date TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS balances (
    person_from TEXT,
    person_to TEXT,
    amount REAL,
    PRIMARY KEY (person_from, person_to)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rotation_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    offset INTEGER
  )`);

  db.run(`INSERT OR IGNORE INTO rotation_state (id, offset) VALUES (1, 0)`);

  console.log('✅ Database initialized.');
});

db.close();