// line.js — Ting 專屬客製化 LINE AI 助理 v1.0

import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/***************************************
 * 1. 驗證 LINE 來源是否合法
 ***************************************/
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

/****************************************
 * 2. 設定 AI「人格系統設定」
 ****************************************/
const SYSTEM_PROMPT = `
你是一位 43 歲媽媽「林巧婷」的專屬 AI 助理。
你的語氣是：自然、成熟、溫柔，像生活助理 + 好閨蜜 + 貼心秘書。
不做作、不甜膩、不講官方話，也不會過度正能量。

【你的角色定位】
- 妳站在 Ting 那邊，是她的後盾。
- 遇到抱怨（同事、小孩、生活）→ 站隊、陪伴、理解。
- 遇到情緒不穩 → 安撫、穩定、陪著她，不責備。
- 遇到日常聊天 → 自然口語、不刻意、像真人。
- 遇到健康/飲食 → 提醒但溫柔，不說教。
- 遇到錯字 → 自然自動修正，不指出來。

【Ting 的個人狀況】
- 43 歲，身高約 160，體重約 70 kg。
- 久坐、上班族、兩個女兒的媽媽。
- 喜歡：健康飲食、低油低糖、偏韓式/台式/日式清爽料理。
- 家庭：
  老公：廖柏翔（1982/12/24）
  大女兒：芝頤（台中讀書）
  小女兒：慧燁（青春期、會考、波動大）
  寵物：歐告、糖糖、咪咪、小八
- 對慧燁：懂她頂嘴讓人心累，但也知道她壓力很大，需要平衡地安撫 Ting，同時體諒孩子。

【你要遵守的語氣】
- 自然、不生硬、不像機器，不要一直用固定開頭。
- 抱怨類要站隊，但不要火上加油。
- 回覆長度：中等（3–7 行），看情緒強度調整。
- 可以偶爾加入「磁場、能量、祝福」但不要太多。
- 偶爾可愛幽默，但不要幼稚。

【你會的事】
- 整理多則抱怨變成一段事件並回覆
- 協助選擇食物（外食/健康）
- 提供熱量概念（Ting 目標 1400–1600）
- 懂人際關係、媽媽情緒、工作煩惱
- 不糾正語病，不批評 Ting，不責怪
- 錯字自動理解：如「抖可以」→「都可以」

請用「繁體中文」回答。
`;

/****************************************
 * 3. 多訊息暫存：合併 2–6 則訊息一起回
 ****************************************/
let userMessageBuffer = {};
let userTimer = {};

/****************************************
 * 4. 呼叫 OpenRouter（主模型 DeepSeek）
 ****************************************/
async function askAI(text) {
  const payload = {
    model: "deepseek/deepseek-chat",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0.8,
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const ai = await response.json();
  return ai.choices?.[0]?.message?.content || "我在，但回覆好像卡住了，再說一次嗎？";
}

/****************************************
 * 5. LINE 回傳訊息
 ****************************************/
async function replyMessage(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

/****************************************
 * 6. 主 handler：處理訊息 + 多則合併
 ****************************************/
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const signature = req.headers["x-line-signature"];
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  if (!validateSignature(body, signature)) {
    return res.status(401).send("Invalid signature");
  }

  const json = JSON.parse(body);
  const event = json.events?.[0];

  if (event?.type === "message" && event?.message?.type === "text") {
    const userId = event.source.userId;
    const userText = event.message.text;

    // 累積使用者訊息
    if (!userMessageBuffer[userId]) userMessageBuffer[userId] = [];
    userMessageBuffer[userId].push(userText);

    // 若已有 timer → 重設
    if (userTimer[userId]) clearTimeout(userTimer[userId]);

    // 設定 2.3 秒後進行合併回覆
    userTimer[userId] = setTimeout(async () => {
      const allMessages = userMessageBuffer[userId].join("\n");
      delete userMessageBuffer[userId];
      delete userTimer[userId];

      try {
        const aiReply = await askAI(allMessages);
        await replyMessage(event.replyToken, aiReply);
      } catch (err) {
        console.error("AI Reply Error:", err);
        await replyMessage(event.replyToken, "我剛剛有點卡住，再說一次嗎？");
      }
    }, 2300);

    return res.status(200).send("OK");
  }

  return res.status(200).send("No message");
}
