# EndField-ChattingAPP(开发中...)

终末地AI群聊 —— 一个有真实账号系统的多人聊天网页:真人之间实时互聊,阿刀、小白、老哥三个 AI 群友也在群里。

## ✨ 功能

- **账号系统**:注册 / 登录,密码 bcrypt 加密存储,JWT 保持 7 天登录态
- **多人实时聊天**:Socket.IO,谁发的消息一目了然,显示在线人数
- **消息持久化**:SQLite 存所有消息,新人进房自动拉最近 50 条历史,重启不丢
- **AI 群友**:阿刀(毒舌)、小白(憨憨)、老哥(玩梗)常驻群里;@ 他们必定回应,平时随机水群
- **安全**:消息前端纯文本渲染(无 XSS),Socket 连接必须携带有效 token

## 🚀 本地运行

```bash
npm install
npm start
```

打开 http://localhost:3000 ,注册个昵称就能聊。

## 🔑 配置 AI 群友

编辑 `.env`:

```
DEEPSEEK_API_KEY=你的DeepSeek API Key
```

不填 key 时真人聊天完全不受影响,只是三个 AI 群友不会说话(服务器日志会提示 key 无效)。

## 📁 结构

```
server.js      # Express + Socket.IO:静态托管、注册/登录 API、Socket 鉴权、消息入库
db.js          # SQLite 初始化(users / messages 两张表,首次启动自动建)
bots.js        # AI 群友逻辑:调 DeepSeek、触发规则、广播
bots.def.js    # 三个 AI 群友的人设定义
public/        # 前端(登录页 + 聊天页)
.env           # 端口、API Key(JWT_SECRET 首次启动自动生成)
e2e-test.js    # 端到端测试(先 npm start 再 node e2e-test.js)
```

## 📌 后续计划

- 多房间 / 私聊
- 图片消息、消息撤回
- 终末地风格 UI
- 部署上线(Render / Railway / VPS),发链接给朋友一起聊
