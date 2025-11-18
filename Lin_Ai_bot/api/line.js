import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 驗證 LINE 簽章
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

export default async function handler(req, res) {
  // LINE 只會用 POST 呼叫，其他先回 OK 避免 404
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // 讀取原始 body（字串）
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(body, signature)) {
    console.error("Invalid signature from LINE");
    return res.status(400).send("Invalid signature");
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    console.error("JSON parse error:", e);
    return res.status(400).send("Bad JSON");
  }

  const events = json.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userText = event.message.text;
    let replyText =
      "我好像當機一下，再問我一次好嗎？（暫時連不到腦袋QQ）";

    try {
      // 🔹 呼叫 OpenAI
      const aiResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "你是一個溫柔、講繁體中文、會陪林巧婷聊天的 LINE AI 助理。",
              },
              { role: "user", content: userText },
            ],
          }),
        }
      );

      const rawText = await aiResponse.text();
      console.log("OpenAI raw response:", rawText);

      if (!aiResponse.ok) {
        console.error("OpenAI HTTP error:", aiResponse.status, rawText);
      } else {
        const aiJson = JSON.parse(rawText);
        const content =
          aiJson?.choices?.[0]?.message?.content?.trim() || null;
        if (content) replyText = content;
      }
    } catch (err) {
      console.error("OpenAI fetch exception:", err);
    }

    // 🔹 回傳給 LINE
    try {
      const lineRes = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: replyText }],
        }),
      });

      const lineText = await lineRes.text();
      console.log(
        "LINE reply status:",
        lineRes.status,
        "body:",
        lineText.slice(0, 500)
      );
    } catch (err) {
      console.error("LINE reply error:", err);
    }
  }

  return res.status(200).send("OK");
}


