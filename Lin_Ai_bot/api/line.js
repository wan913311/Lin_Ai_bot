import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 驗證 LINE 傳來的訊息是否真的來自 LINE
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

export default async function handler(req, res) {
  // 讀取 LINE 傳來的 body
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  // 驗證簽章
  const signature = req.headers["x-line-signature"];
  if (!validateSignature(body, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const json = JSON.parse(body);
  const events = json.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userText = event.message.text;

    // 發送訊息給 OpenAI
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是一個溫柔、講繁體中文、會陪林巧婷聊天的 LINE AI 助理。" },
          { role: "user", content: userText },
        ],
      }),
    });

    const aiJson = await aiResponse.json();
    const reply =
      aiJson?.choices?.[0]?.message?.content ||
      "我好像當機一下，再問我一次好嗎？";

    // 回覆訊息給 LINE
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: reply }],
      }),
    });
  }

  res.status(200).send("OK");
}
