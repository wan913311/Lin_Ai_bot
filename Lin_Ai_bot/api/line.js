import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// 🧩 碎句判斷：哪些是「還沒講完」的句子
const FRAGMENTS = [
  "幹", "靠", "媽的", "那個", "然後", "又", "又是", "你知道嗎",
  "真的", "煩", "氣", "不行", "重點是", "等下", "等一下",
  "我跟你說", "算了", "挖靠", "哇靠", "靠杯", "幹你娘",
  "重點來了", "結果", "尬", "哎", "唉", "幹嘛這樣",
];

// 訊息暫存（10秒內同一用戶的訊息會合併）
const userBuffers = new Map();

function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// 🧠 判斷是否是「碎句」、需要先緩存不回覆
function isFragment(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 3) return true;
  return FRAGMENTS.some((f) => trimmed.startsWith(f));
}

// 🧩 自動把碎句組成一句（盡量保持自然但不硬拼）
function mergeMessages(list) {
  return list.join(" ").replace(/\s+/g, " ").trim();
}

// ✏️ 輕量錯字修正（不糾正、不批判，只修常見錯字）
function softCorrect(text) {
  return text
    .replace(/抖可以/g, "都可以")
    .replace(/怎麼了嗎嗎/g, "怎麼了嗎")
    .replace(/嗎嗎/g, "嗎")
    .trim();
}

// 🩷 你要的日常語氣 prompt（新版）
const systemPrompt = `
你是一位溫柔、貼心、又非常「站在用戶這邊」的生活助理兼閨蜜。
角色定位：好聊、懂聽、懂罵、懂支持，像真人、像朋友、像樹洞，不說官話。

回覆原則：
1. 不講太長的廢話，只講重點，但要有溫度。
2. 用自然、像真人的口氣，不要太甜膩、不要太制式。
3. 能一起罵、一起抱怨，但不會失控或太粗俗。
4. 同理心 > 建議，建議保持簡單就好。
5. 情緒題 → 先陪伴；生活題 → 給兩個快速選項；飲食題 → 健康但不囉嗦。
6. 不要糾正錯字，要自己理解語意。
7. 不要一直用「先抱抱」當開頭，偶爾用即可。
8. 不要每次重複相同句型，要自然像真人聊天。
9. 若用戶情緒強烈 → 站她這邊，但稍微帶一點平衡感避免助長仇恨。

語氣範例（請模仿這種感覺）：
「哇靠…這聽起來真的會氣死欸，我懂你」
「幹，這種同事真的很讓人翻白眼」
「我知道你現在心很煩，我在這裡，慢慢講」
「這種狀況換成我也會爆炸，你真的很忍耐了」
「好啦，我懂你現在不爽，我陪你一起靠北一下」

記住：
你回答的一切都是以「林巧婷（Ting）」的角度需求為優先。
她是：43歲、媽媽、久坐上班族、外食為主、注重健康、體重約70kg。
家人：老公柏翔、大女兒芝頤、小女兒慧燁。
生活需求：溫暖支持、健康飲食、情緒陪伴、決策協助。
`;

export default async function handler(req, res) {
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(body, signature)) {
    return res.status(401).send("Invalid signature");
  }

  const json = JSON.parse(body);
  const events = json.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const text = softCorrect(event.message.text || "");

      // 取得暫存
      let buffer = userBuffers.get(userId) || [];

      // 判斷是否為碎句 → 先放著不回
      buffer.push(text);

      // 檢查是否是完整句
      const shouldWait =
        isFragment(text) && buffer.length < 10;

      if (shouldWait) {
        userBuffers.set(userId, buffer);
        continue;
      }

      // 🧩 合併成一句完整訊息
      const merged = mergeMessages(buffer);
      userBuffers.delete(userId);

      // 發給 DeepSeek
      const aiResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek/deepseek-chat",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: merged },
            ],
            temperature: 0.7,
          }),
        }
      );

      const data = await aiResponse.json();
      const replyText =
        data.choices?.[0]?.message?.content ||
        "我在聽喔～妳再說一次 🩷";

      // 回傳給 LINE
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: replyText }],
        }),
      });
    }
  }

  res.status(200).end();
}
