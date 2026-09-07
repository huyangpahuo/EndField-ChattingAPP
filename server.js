const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");

const db = require("./db");
const bots = require("./bots");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
global.io = io;

app.use(express.json());
// 前端直接由本服务器托管,不再依赖手动开 html 文件
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET;
const CHAT_ROOM = 1; // 目前只有一个大群,后续可扩展多房间

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

// ================= 🔐 注册 / 登录 =================
app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]{2,16}$/.test(username)) {
    return res
      .status(400)
      .json({ error: "昵称需为2-16位中文、字母、数字或下划线" });
  }
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: "密码需为6-64位" });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "这个昵称已经被占用了" });

  const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
    username
  )}`;
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, avatar) VALUES (?, ?, ?)")
    .run(username, hash, avatar);

  const user = { id: info.lastInsertRowid, username, avatar };
  res.json({ token: signToken(user), user });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db
    .prepare("SELECT * FROM users WHERE username = ? AND is_bot = 0")
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "昵称或密码不对" });
  }
  const safe = { id: user.id, username: user.username, avatar: user.avatar };
  res.json({ token: signToken(safe), user: safe });
});

// ================= 🔌 Socket 实时通道 =================
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token || "", JWT_SECRET);
    const user = db.prepare("SELECT id, username, avatar FROM users WHERE id = ?").get(payload.uid);
    if (!user) return next(new Error("用户不存在"));
    socket.user = user;
    next();
  } catch {
    next(new Error("登录已过期,请重新登录"));
  }
});

io.on("connection", (socket) => {
  const user = socket.user;

  // 进房先拉最近 50 条历史
  const history = db
    .prepare(
      "SELECT id, user_id AS userId, name, avatar, text, created_at FROM messages ORDER BY id DESC LIMIT 50"
    )
    .all()
    .reverse();
  socket.emit("history", history);

  // 广播在线人数
  const onlineCount = io.engine.clientsCount;
  io.emit("online", { count: onlineCount });

  socket.on("userMsg", (raw) => {
    const text = String(raw ?? "").trim().slice(0, 500);
    if (!text) return;

    const msg = {
      userId: user.id,
      name: user.username,
      avatar: user.avatar,
      text,
    };
    db.prepare(
      "INSERT INTO messages (user_id, name, avatar, text) VALUES (?, ?, ?, ?)"
    ).run(msg.userId, msg.name, msg.avatar, msg.text);
    io.emit("msg", msg);
    bots.pushCtx(msg);

    bots.onNewHumanMessage(text);
  });

  socket.on("disconnect", () => {
    io.emit("online", { count: io.engine.clientsCount });
  });
});

// ================= 🚀 启动 =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器启动成功: http://localhost:${PORT}`);
});
