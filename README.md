# 🏡 Shared Living Manager

A Telegram bot + web admin panel to manage cleaning schedules 🧹 and shared expenses 💸 for apartments, WGs, and shared flats.  

---

## ✨ Features

✅ Automatic rotating cleaning schedule (adapts to 3 or 4 people)  
✅ Shared expense tracking (like Splitwise)  
✅ Per-person balance tracking with net settlement  
✅ Telegram bot commands:
- `/mytask` → see your next cleaning duty
- `/mybalance` → check what you owe and are owed
- `/addexpense` → log a shared purchase

✅ Web admin panel with:
- Cleaning rotation preview
- Expense list
- Per-person balance cards
- Manual expense entry form

---

## ⚙️ Setup

### 1️⃣ Clone the repo

```bash
git clone https://github.com/navidjavid/shared-living-manager.git
cd flatmate-buddy
```

---

### 2️⃣ Install dependencies

```bash
npm install
```

---

### 3️⃣ Set up the `.env`

Create a `.env` file:

```
BOT_TOKEN=your_telegram_bot_token_here
```

---

### 4️⃣ Initialize the database

```bash
node init_db.js
```

---

### 5️⃣ Start the server

```bash
node index.js
```

Visit the admin panel at:
```
http://localhost:3000
```

---

## 🚀 Deploy

You can deploy this on:
✅ Render  
✅ Railway  
✅ Any VPS / server with Node.js

Make sure to set the `BOT_TOKEN` as an environment variable.

---

## 🤖 How to Get a Telegram Bot Token

1️⃣ Go to [@BotFather](https://t.me/BotFather) on Telegram  
2️⃣ Create a new bot → get the token  
3️⃣ Paste the token in your `.env`

---

## 📂 Project Structure

```
/project
  |-- index.js          → main server + bot logic
  |-- init_db.js        → sets up the SQLite database
  |-- schedule.db       → your live data (excluded by .gitignore)
  |-- views/            → EJS templates for the admin panel
  |-- .env              → bot token (excluded by .gitignore)
  |-- .gitignore        → ignores node_modules, .env, etc.
```

---

## 💡 Future Ideas

- Notifications for missed cleanings  
- Expense categories (groceries, bills, etc.)  
- Settling up via payment links  
- Multilingual bot commands

---

## 📜 License

MIT License — free to use, modify, and share!