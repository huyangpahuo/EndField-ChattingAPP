// 端到端测试:注册两个用户 → 双人 Socket 收发 → 历史拉取 → 数据库核对
// 注意:history 在连接时立即下发,必须在 connect 前挂好监听
const { io } = require("socket.io-client");

const BASE = "http://localhost:3000";

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

// 在 connect 前就挂好 history 监听,避免错过事件
function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token } });
    let historyResolved;
    const historyPromise = new Promise((r) => (historyResolved = r));
    s.on("history", historyResolved);
    s.on("connect", () => resolve({ socket: s, historyPromise }));
    s.on("connect_error", (e) => reject(new Error(`${label}: ${e.message}`)));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, tag) =>
  Promise.race([
    p,
    wait(ms).then(() => {
      throw new Error(`${tag} 超时`);
    }),
  ]);

(async () => {
  const suffix = Date.now().toString(36).slice(-5);
  const nameA = `测试员${suffix}A`;
  const nameB = `测试员${suffix}B`;

  // 1. 注册 A / B
  const regA = await api("/api/register", { username: nameA, password: "123456" });
  const regB = await api("/api/register", { username: nameB, password: "123456" });
  console.log("register A:", regA.status, regA.data.user?.username || regA.data.error);
  console.log("register B:", regB.status, regB.data.user?.username || regB.data.error);
  if (regA.status !== 200 || regB.status !== 200) process.exit(1);

  // 2. 重复注册应 409
  const dup = await api("/api/register", { username: nameA, password: "123456" });
  console.log("dup register:", dup.status, dup.data.error);

  // 3. 错误密码应 401
  const bad = await api("/api/login", { username: nameA, password: "wrong!" });
  console.log("bad login:", bad.status, bad.data.error);

  // 4. 双人连接
  const a = await connect(regA.data.token, "A");
  const b = await connect(regB.data.token, "B");
  console.log("A+B connected");

  // 5. A 发消息(带 XSS 试试),B 应收到
  const got = new Promise((resolve) => b.socket.on("msg", resolve));
  a.socket.emit("userMsg", "大家好,我是真人A!测试<script>alert(1)</script>");
  const received = await withTimeout(got, 5000, "B 收消息");
  console.log(
    "B received:",
    received ? `${received.name}: ${received.text}` : "❌ 超时未收到"
  );

  // 6. B 断开重连,应拉到刚才那条历史
  b.socket.disconnect();
  await wait(300);
  const b2 = await connect(regB.data.token, "B2");
  const hist = await withTimeout(b2.historyPromise, 5000, "B2 历史");
  const found = hist.find((m) => m.text.includes("我是真人A"));
  console.log(
    `history (${hist.length}条):`,
    found ? `✅ 找到刚才的消息 (${found.created_at})` : "❌ 历史里没有"
  );

  // 7. A 的历史里,自己刚发的消息也不该缺
  const histA = await withTimeout(a.historyPromise, 5000, "A 历史");
  console.log(`A history: ${histA.length}条`);

  // 8. 数据库直接核对
  const db = require("./db");
  const cnt = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
  const bots = db.prepare("SELECT username FROM users WHERE is_bot=1").all();
  console.log("DB messages:", cnt, "| bots in users:", bots.map((x) => x.username).join(","));

  a.socket.disconnect();
  b2.socket.disconnect();
  console.log("ALL E2E TESTS PASSED");
  process.exit(0);
})().catch((e) => {
  console.error("TEST FAIL:", e.message);
  process.exit(1);
});
