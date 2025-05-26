
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Telegraf, Markup } = require('telegraf');
const bodyParser = require('body-parser');

const app = express();
const db = new sqlite3.Database('./schedule.db');
require('dotenv').config();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  db.all('SELECT name FROM people ORDER BY id', (err, people) => {
    db.all('SELECT * FROM expenses ORDER BY date DESC LIMIT 4', (err, expenses) => {
      const upcomingWeeks = [];
      db.get('SELECT offset FROM rotation_state WHERE id = 1', (err, row) => {
        const offset = row ? row.offset : 0;
        const names = people.map(p => p.name);
        for (let i = 0; i < 4; i++) {
        const rotated = [...names];
        for (let j = 0; j < (offset + i) % names.length; j++) rotated.push(rotated.shift());

          const today = new Date();
          const nextSunday = new Date(today);
          nextSunday.setDate(today.getDate() + (7 - today.getDay()) + i * 7);
          const [year, month, day] = nextSunday.toISOString().split('T')[0].split('-');
          const sundayDate = `${day}-${month}-${year}`;

          let kitchen, bathroom, toilet;
          if (names.length === 4) {
            kitchen = `${rotated[0]} & ${rotated[1]}`;
            bathroom = rotated[2];
            toilet = rotated[3];
          } else {
            kitchen = rotated[0];
            bathroom = rotated[1];
            toilet = rotated[2];
          }

          upcomingWeeks.push({ date: sundayDate, kitchen, bathroom, toilet });
        }

        db.all('SELECT person_from, person_to, amount FROM balances WHERE amount > 0', (err, balances) => {
          res.render('index', { people, expenses, upcomingWeeks, balances });
        });
      });
    });
  });
});

app.post('/sendweekly', (req, res) => {
  sendWeeklyAssignments();
  res.redirect('/');
});
app.post('/add-expense', (req, res) => {
  const { payer, amount, description } = req.body;
  const today = new Date().toISOString().split('T')[0];

  db.run('INSERT INTO expenses (payer, amount, description, date) VALUES (?, ?, ?, ?)', [payer, amount, description, today]);

  db.all('SELECT name FROM people', (err, people) => {
    const share = amount / people.length;

    people.forEach(p => {
      if (p.name !== payer) {
        // Check if person already owes payer
        db.get('SELECT amount FROM balances WHERE person_from = ? AND person_to = ?', [p.name, payer], (err, row) => {
          if (row) {
            // If exists, update the amount
            db.run('UPDATE balances SET amount = amount + ? WHERE person_from = ? AND person_to = ?', [share, p.name, payer]);
          } else {
            // Check if payer owes person (reverse direction)
            db.get('SELECT amount FROM balances WHERE person_from = ? AND person_to = ?', [payer, p.name], (err, reverseRow) => {
              if (reverseRow) {
                if (reverseRow.amount > share) {
                  // Reduce reverse balance
                  db.run('UPDATE balances SET amount = amount - ? WHERE person_from = ? AND person_to = ?', [share, payer, p.name]);
                } else if (reverseRow.amount < share) {
                  // Flip balance direction
                  const newAmount = share - reverseRow.amount;
                  db.run('DELETE FROM balances WHERE person_from = ? AND person_to = ?', [payer, p.name], () => {
                    db.run('INSERT INTO balances (person_from, person_to, amount) VALUES (?, ?, ?) ON CONFLICT(person_from, person_to) DO UPDATE SET amount = ?', [p.name, payer, newAmount, newAmount]);
                  });
                } else {
                  // Equal → cancel out
                  db.run('DELETE FROM balances WHERE person_from = ? AND person_to = ?', [payer, p.name]);
                }
              } else {
                // No record yet → insert fresh
                db.run('INSERT INTO balances (person_from, person_to, amount) VALUES (?, ?, ?)', [p.name, payer, share]);
              }
            });
          }
        });
      }
    });

    res.redirect('/');
  });
});



bot.telegram.setMyCommands([
  { command: 'mytask', description: 'Show your next cleaning task' },
  { command: 'mybalance', description: 'Show what you owe and are owed' },
  { command: 'addexpense', description: 'Add a shared expense' }
]);

bot.start((ctx) => {
  const name = ctx.from.first_name;
  const chatId = ctx.chat.id.toString();
  db.run('INSERT OR REPLACE INTO people (name, chat_id) VALUES (?, ?)', [name, chatId]);
  ctx.reply('✅ You are registered! Use /mytask, /mybalance, /addexpense');
});

bot.command('mytask', (ctx) => {
  const name = ctx.from.first_name;
  db.all('SELECT name FROM people ORDER BY id', (err, people) => {
    db.get('SELECT offset FROM rotation_state WHERE id = 1', (err, row) => {
      const offset = row ? row.offset : 0;
      const names = people.map(p => p.name);
      for (let i = 0; i < 10; i++) {
        const rotated = [...names];
        for (let j = 0; j < (offset + i) % names.length; j++) rotated.push(rotated.shift());

        const today = new Date();
        const nextSunday = new Date(today);
        nextSunday.setDate(today.getDate() + (7 - today.getDay()) + i * 7);
        const [year, month, day] = nextSunday.toISOString().split('T')[0].split('-');
        const sundayDate = `${day}-${month}-${year}`;

        const tasks = [];
        if (names.length === 4) {
          if (rotated[0] === name || rotated[1] === name) tasks.push('🍽 Kitchen');
          if (rotated[2] === name) tasks.push('🛁 Bathroom');
          if (rotated[3] === name) tasks.push('🚽 Toilet');
        } else {
          if (rotated[0] === name) tasks.push('🍽 Kitchen');
          if (rotated[1] === name) tasks.push('🛁 Bathroom');
          if (rotated[2] === name) tasks.push('🚽 Toilet');
        }

        if (tasks.length > 0) {
          return ctx.reply(`✅ Your next task on ${sundayDate}:\n\n${tasks.join('\\n')}`);
        }
      }
      ctx.reply('🎉 You have no upcoming tasks!');
    });
  });
});

bot.command('mybalance', (ctx) => {
  const user = ctx.from.first_name;
  db.all('SELECT person_from, person_to, amount FROM balances WHERE person_from = ? OR person_to = ?', [user, user], (err, rows) => {
    let owes = '', owed = '';
    rows.forEach(r => {
      if (r.person_from === user && r.amount > 0) {
        owes += `➡️ You owe ${r.person_to}: €${r.amount.toFixed(2)}\n`;
      } else if (r.person_to === user && r.amount > 0) {
        owed += `⬅️ ${r.person_from} owes you: €${r.amount.toFixed(2)}\n`;
      }
    });
    ctx.replyWithMarkdown(`*💸 Your Balance*
${owes || '✅ You owe nothing!'}
${owed || '✅ No one owes you!'}
`, Markup.inlineKeyboard([
      Markup.button.callback('🔄 Settle Up', `settleup_${user}`)
    ]));
  });
});

bot.action(/settleup_(.+)/, (ctx) => {
  const user = ctx.match[1];
  db.run('DELETE FROM balances WHERE person_from = ? OR person_to = ?', [user, user], () => {
    ctx.editMessageText('✅ All your balances have been settled.');
  });
});

const sessions = {};
bot.command('addexpense', (ctx) => {
  sessions[ctx.from.id] = { step: 'awaiting_amount' };
  ctx.reply('💰 How much did you spend?');
});

bot.on('text', (ctx) => {
  const session = sessions[ctx.from.id];
  if (!session) return;

  if (session.step === 'awaiting_amount') {
    session.amount = parseFloat(ctx.message.text);
    session.step = 'awaiting_description';
    ctx.reply('📝 What was it for?');
  } else if (session.step === 'awaiting_description') {
    session.description = ctx.message.text;
    session.step = null;
    const name = ctx.from.first_name;
    const today = new Date().toISOString().split('T')[0];
    db.run('INSERT INTO expenses (payer, amount, description, date) VALUES (?, ?, ?, ?)', [name, session.amount, session.description, today]);
    db.all('SELECT name FROM people', (err, people) => {
      const share = session.amount / people.length;
      people.forEach(p => {
        if (p.name !== name) {
          db.run(`INSERT INTO balances (person_from, person_to, amount) VALUES (?, ?, ?) ON CONFLICT(person_from, person_to) DO UPDATE SET amount = amount + excluded.amount`, [p.name, name, share]);
        }
      });
      ctx.reply('✅ Expense recorded and split!');
    });
    delete sessions[ctx.from.id];
  }
});

function sendWeeklyAssignments() {
  db.all('SELECT name, chat_id FROM people ORDER BY id', (err, people) => {
    db.get('SELECT offset FROM rotation_state WHERE id = 1', (err, row) => {
      const offset = row ? row.offset : 0;
      const names = people.map(p => p.name);
      const rotated = [...names];
      for (let i = 0; i < offset % names.length; i++) rotated.push(rotated.shift());
      const assignments = { kitchen: rotated[0], bathroom: rotated[1], toilet: rotated[2] };
      Object.entries(assignments).forEach(([task, person]) => {
        const target = people.find(p => p.name === person);
        if (target && target.chat_id) {
          bot.telegram.sendMessage(target.chat_id, `🧹 This week you are assigned to: ${task}`);
        }
      });
      const newOffset = (offset + 1) % names.length;
      db.run('INSERT OR REPLACE INTO rotation_state (id, offset) VALUES (1, ?)', [newOffset]);
    });
  });
}

bot.launch();
app.listen(3000, () => console.log('✅ Admin panel at http://localhost:3000'));