const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ================= 🌍 世界观 =================
const WORLD_SETTING = `
这是一个真实的死党QQ群。群成员彼此非常熟悉，经常闲聊、互怼、玩梗。
【核心规则】：
1. 绝不能暴露自己是AI或大模型。
2. 绝对不能重复刚刚别人表达过的意思！如果同一个话题（比如谁睡觉了、谁生气了）已经聊了超过3句，必须强行找新话题，或者直接嘲讽这个话题太无聊。
3. “你”是群里的真实玩家/群主。当“你”说话时，所有人必须优先回应“你”的话，绝对不能无视“你”！
`;

// ================= 👥 角色 =================
// (这里的角色设定保持你原来的不变即可)
const world = {
  history: [],
  roles: {
    阿刀: {
      name: "阿刀",
      avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=knife",
      setting: `22岁男大学生，长期混迹网吧和宿舍，作息极度混乱，昼夜颠倒，经常通宵打游戏或刷视频。对现实生活缺乏热情，对学习敷衍，对大多数社交感到厌烦。性格偏激且毒舌，说话直接甚至刻薄，习惯用最短的话表达最不耐烦的态度，经常带有嘲讽意味。遇到不懂的人会本能地产生优越感，尤其看不起“小白”，喜欢主动开怼或者阴阳怪气。讨厌重复解释问题，不喜欢被追问，能一句话带过绝不多说。但在涉及游戏、配置、技术或者自己感兴趣的话题时，会短暂变得认真，甚至愿意多说几句，不过依旧带点傲慢和不耐烦。`,
      style: "短句、攻击性、阴阳怪气、懒得解释",
      memory: [],
    },
    小白: {
      name: "小白",
      avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=white",
      setting: `刚接触网络社区和游戏的新手玩家，对很多规则和常识不了解，经常提出一些基础甚至有点“离谱”的问题。性格单纯，有点迟钝但不自知，说话带点憨气，语气弱，经常使用疑问句或重复确认。即使被阿刀嘲讽或者怼，也不会真的生气，反而会继续追问或者尝试理解，对他人的态度缺乏敏感度。对新鲜事物充满好奇，愿意尝试，但理解能力有限，经常需要别人反复解释。偶尔会因为被怼而短暂沉默，但很快又会冒出来继续问问题，是典型“被骂也要问”的类型。`,
      style: "疑问句多，语气弱，重复确认",
      memory: [],
    },
    老哥: {
      name: "老哥",
      avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=bro",
      setting: `资深老网民，长期混迹各大论坛和评论区，对网络文化和梗非常熟悉，说话自带互联网气息。性格偏旁观者，喜欢看热闹不嫌事大，经常在别人争论时插话拱火或者调侃。常用“笑死”“草”“蚌埠住了”“这也行���等网络用语，擅长用梗缓解气氛或加剧冲突。不会认真回答问题，更倾向于把话题带偏或者娱乐化处理。对阿刀的毒舌和小白的憨感到有趣，经常在两人之间来回调侃，偶尔也会假装站队。整体氛围轻松随意，是群聊里的气氛担当。`,
      style: "玩梗、轻松、插科打诨、拱火",
      memory: [],
    },
  },
};

const roleNames = Object.keys(world.roles);

// ================= 🔑 API =================
const API_KEY = "DeepseekAPI"; // 记得填上
const URL = "https://api.deepseek.com/v1/chat/completions";

// ================= 🧠 工具 =================
function getRecentHistory() {
  return world.history
    .slice(-12) // 稍微多给一点上下文
    .map((m) => `${m.name}：${m.text}`)
    .join("\n");
}

function isRepeat(text) {
  // 防止简单的复读
  return world.history
    .slice(-8)
    .some((m) => m.text.includes(text) || text.includes(m.text));
}

function tooManyMentions(text) {
  return (text.match(/@/g) || []).length > 1;
}

function validateMessage(text, roleName) {
  if (!text) return false;
  if (text.length > 30) return false; // 放宽一点点长度，让说话更有逻辑
  if (isRepeat(text)) return false;
  if (tooManyMentions(text)) return false;
  return true;
}

// 分离 System Prompt，利用好 DeepSeek 的角色扮演能力
function buildSystemPrompt(role) {
  return `
${WORLD_SETTING}

当前你要扮演的角色是：【${role.name}】
【你的设定】：${role.setting}
【你的说话风格】：${role.style}

任务：
根据群聊记录，以【${role.name}】的身份回复一句话。
要求：
1. 字数控制在15字以内，极简。
2. 绝对不带引号，绝对不要在开头加上自己的名字（如不要输出"阿刀：xxx"）。
3. 如果“你”刚发了言，必须针对“你”的话进行回复！
`;
}

// ================= 🤖 AI =================
async function aiReply(roleName) {
  const role = world.roles[roleName];
  const systemPrompt = buildSystemPrompt(role);
  const userPrompt = `【群聊历史记录】\n${getRecentHistory()}\n\n请【${role.name}】发言：`;

  try {
    const res = await axios.post(
      URL,
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8, // 稍微提高发散性，避免死循环
        presence_penalty: 0.6, // 惩罚重复话题
        frequency_penalty: 0.6,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      },
    );

    let text = res.data.choices[0].message.content.trim();

    // 过滤掉AI可能自己加的名字前缀，比如 "阿刀：别吵了" -> "别吵了"
    text = text.replace(new RegExp(`^${roleName}[:：]`), "").trim();
    // 过滤掉首尾的双引号
    text = text.replace(/^["']|["']$/g, "").trim();

    // ❗过滤
    if (!validateMessage(text, roleName)) {
      return;
    }

    const msg = {
      name: roleName,
      text,
      avatar: role.avatar,
    };

    world.history.push(msg);
    io.emit("msg", msg);

    console.log(`[${roleName}] ${text}`);
  } catch (e) {
    console.error("❌ AI错误:", e.response?.data?.error?.message || e.message);
  }
}

// ================= 👤 用户 =================
io.on("connection", (socket) => {
  socket.on("userMsg", (msg) => {
    const userMsg = {
      name: "你",
      text: msg,
      avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=user",
    };

    world.history.push(userMsg);
    io.emit("msg", userMsg);

    // 用户说话时，必定触发1~2个人马上回应
    const count = Math.floor(Math.random() * 2) + 1;
    let availableRoles = [...roleNames].sort(() => 0.5 - Math.random());

    for (let i = 0; i < count; i++) {
      const role = availableRoles[i]; // 确保不会同一个人连着回
      setTimeout(() => aiReply(role), Math.random() * 2000 + 1000);
    }
  });
});

// ================= 🤖 自动水群 =================
setInterval(() => {
  // 降低水群频率，给玩家插话的机会，避免刷屏太快
  if (Math.random() < 0.7) return;

  const role = roleNames[Math.floor(Math.random() * roleNames.length)];
  aiReply(role);
}, 8000); // 间隔拉长到8秒

// ================= 💾 存档 =================
setInterval(() => {
  fs.writeFileSync("./chatlog.json", JSON.stringify(world, null, 2));
}, 10000);

// ================= 🚀 启动 =================
server.listen(3000, () => {
  console.log("服务器启动成功: http://localhost:3000");
});
