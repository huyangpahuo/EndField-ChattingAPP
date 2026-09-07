require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// .env 里没配 JWT_SECRET 时,自动生成一个并写回,保证重启后已登录的人不掉线
const envPath = path.join(__dirname, ".env");
function ensureJwtSecret() {
  if (process.env.JWT_SECRET) return;
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (!/^JWT_SECRET=.+$/m.test(env)) {
    const secret = require("crypto").randomBytes(32).toString("hex");
    env = env.replace(/^JWT_SECRET=.*$/m, "").trimEnd();
    env = (env ? env + "\n" : "") + `JWT_SECRET=${secret}\n`;
    fs.writeFileSync(envPath, env);
  }
  require("dotenv").config({ override: true });
}
ensureJwtSecret();

const db = new Database(path.join(__dirname, "chat.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

// AI 群友也占一个 user 行,is_bot=1,这样消息表里人和 bot 用同一套 user_id
const botDefs = require("./bots.def");
const insertBot = db.prepare(
  "INSERT OR IGNORE INTO users (username, password_hash, avatar, is_bot) VALUES (?, '', ?, 1)"
);
for (const bot of Object.values(botDefs)) {
  insertBot.run(bot.name, bot.avatar);
}

module.exports = db;
