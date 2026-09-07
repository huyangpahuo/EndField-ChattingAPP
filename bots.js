const axios = require("axios");
const db = require("./db");
const botDefs = require("./bots.def");

const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const URL = "https://api.deepseek.com/v1/chat/completions";

const WORLD_SETTING = `
这是一个真实的死党QQ群。群成员彼此非常熟悉,经常闲聊、互怼、玩梗。
【核心规则】:
1. 绝不能暴露自己是AI或大模型。
2. 绝对不能重复刚刚别人表达过的意思!如果同一个话题已经聊了超过3句,必须强行找新话题,或者直接嘲讽这个话题太无聊。
3. 群里的消息除了你还有真人,真人说话时所有人必须优先回应真人,绝对不能无视!
`;

const BOT_NAMES = Object.keys(botDefs);

// ==== 会话内上下文,重启即清空,不影响消息持久化 ====
const chatCtx = {
  history: [], // 最近若干条 {name, text}
  lastReplyAt: {}, // 每个 bot 上次发言时间戳,错开回复
};

function pushCtx(msg) {
  chatCtx.history.push({ name: msg.name, text: msg.text });
  if (chatCtx.history.length > 20) chatCtx.history.shift();
}

function getRecentHistory() {
  return chatCtx.history
    .slice(-12)
    .map((m) => `${m.name}:${m.text}`)
    .join("\n");
}

function isRepeat(text) {
  return chatCtx.history
    .slice(-8)
    .some((m) => m.text.includes(text) || text.includes(m.text));
}

function validateMessage(text) {
  if (!text) return false;
  if (text.length > 50) return false;
  if (isRepeat(text)) return false;
  if ((text.match(/@/g) || []).length > 1) return false;
  return true;
}

function buildSystemPrompt(role) {
  return `
${WORLD_SETTING}

当前你要扮演的角色是:【${role.name}】
【你的设定】:${role.setting}
【你的说话风格】:${role.style}

任务:
根据群聊记录,以【${role.name}】的身份回复一句话。
要求:
1. 字数控制在25字以内,可以是一句也可以是短短两三句,极简。
2. 绝对不带引号,绝对不要在开头加上自己的名字(如不要输出"阿刀:xxx")。
3. 如果真人刚发了言,必须针对真人的话进行回复!
`;
}

// ==== 落库 + 广播:bot 消息和真人消息走同一条管道 ====
function broadcast(msg) {
  db.prepare(
    "INSERT INTO messages (user_id, name, avatar, text) VALUES (?, ?, ?, ?)"
  ).run(msg.userId, msg.name, msg.avatar, msg.text);
  pushCtx(msg);
  if (global.io) global.io.emit("msg", msg);
  console.log(`[${msg.name}] ${msg.text}`);
}

async function callDeepSeek(role, roleName) {
  const res = await axios.post(
    URL,
    {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: buildSystemPrompt(role) },
        {
          role: "user",
          content: `【群聊历史记录】\n${getRecentHistory()}\n\n请【${roleName}】发言:`,
        },
      ],
      temperature: 0.8,
      presence_penalty: 0.6,
      frequency_penalty: 0.6,
      max_tokens: 60,
    },
    {
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 20000,
    }
  );
  return res.data.choices[0].message.content;
}

async function botReply(roleName) {
  const role = botDefs[roleName];
  const botUser = db
    .prepare("SELECT id, username, avatar FROM users WHERE username = ? AND is_bot = 1")
    .get(roleName);
  if (!botUser) return;

  try {
    let text = (await callDeepSeek(role, roleName)).trim();
    text = text
      .replace(new RegExp(`^${roleName}[:：]\\s*`), "")
      .replace(/^["'「」“”]+|["'「」“”]+$/g, "")
      .trim();

    if (!validateMessage(text)) return;

    broadcast({
      userId: botUser.id,
      name: roleName,
      avatar: botUser.avatar,
      text,
    });
  } catch (e) {
    console.error(
      `❌ AI(${roleName})错误:`,
      e.response?.data?.error?.message || e.message
    );
  }
}

// 触发 bot 发言;deltas 控制延迟,避免多个 bot 同时刷屏
function triggerBots(roleNames, minDelay = 1200, spread = 2500) {
  const now = Date.now();
  roleNames.forEach((name, i) => {
    const last = chatCtx.lastReplyAt[name] || 0;
    const wait = Math.max(last + 3000 - now, 0) + minDelay + i * spread;
    chatCtx.lastReplyAt[name] = now + wait;
    setTimeout(() => botReply(name), wait);
  });
}

// 谁被 @ 了就谁来接话;没人被 @ 就随机 1 个概率接话
function onNewHumanMessage(text) {
  const mentioned = BOT_NAMES.filter((n) => text.includes("@" + n));
  if (mentioned.length > 0) {
    triggerBots(mentioned.slice(0, 2));
    return;
  }
  if (Math.random() < 0.55) {
    triggerBots([BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]], 1500, 0);
  }
}

// 自动水群, quieter than before
setInterval(() => {
  if (Math.random() < 0.75) return;
  triggerBots([BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]], 500, 0);
}, 15000);

module.exports = { broadcast, onNewHumanMessage, pushCtx };
