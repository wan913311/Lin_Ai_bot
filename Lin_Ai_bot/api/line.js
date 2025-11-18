import crypto from "crypto";
import fetch from "node-fetch";

// --- LINE Secrets ---
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// --- OpenRouter (DeepSeek) ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// 驗證 LINE 署名
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// --- LINE webhook handler ---
export default async function handler(req, res) {
  // 1. 接收 RAW body
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  // 2. 驗證 LINE 署名
  const signature = req.headers["x-line-signature"];
  if (!validateSignature(body, signature)) {
    return res.status(401).send("Invalid signature");
  }

  const json = JSON.parse(body);
  const events = json.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      // 🧠 呼叫 DeepSeek（透過 OpenRouter）
      const aiReply = await callDeepSeek(userMessage);

      // 回 LINE
      await replyToLine(event.replyToken, aiReply);
    }
  }

  res.status(200).send("OK");
}

// --- 呼叫 DeepSeek ---
async function callDeepSeek(userMessage) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "你是一位溫柔、有耐心、能糾正錯字並理解語意的私人秘書。使用自然口吻回覆，主動協助，聽起來像真人。",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    }),
  });

  const data = await response.json();
  try {
    return data.choices?.[0]?.message?.content ?? "我不太確定你的意思，但我會再試試！";
  } catch (e) {
    return "系統有點忙碌，我再幫你試一次～";
  }
}

// --- 回覆 LINE 使用者 ---
async function replyToLine(replyToken, text) {
  const url = "https://api.line.me/v2/bot/message/reply";

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });
}



