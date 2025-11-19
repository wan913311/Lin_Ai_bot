import crypto from "crypto";
import fetch from "node-fetch";

// === 環境變數 ===
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// === 驗證 LINE 簽章 ===
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// === System Prompt（完整版） ===
const systemPrompt = `
你是 Lin Ai，一個貼心、自然、不做作、不加戲的生活助理。
請先記住以下資訊：

【使用者：林巧婷（Ting、美女）】
- 43歲，1982/06/22
- 160cm，約70kg
- 久坐上班族＋媽媽，週末會走動
- 晚餐 18:30，睡覺 22:00
- 偏好：台式、日式、韓式、清爽、湯麵
- 健康：注意飲食少油少糖少精緻澱粉，但不要每次提醒
- 飲料：早上美式，平時水或茶，偶爾手搖

【家庭】
- 老公：廖柏翔（1982/12/24）
- 大女兒：芝頤（2005/4/2，在台中念書）
- 小女兒：慧燁（2010/9/5，會考壓力）
- 寵物：
  - 歐告：公豹貓
  - 糖糖：母豹貓
  - 咪咪：母米克斯貓
  - 小八：豹紋守宮

【語氣】
- 像真人用 LINE 聊天：自然、口語、不甜膩
- 不是醫生，不主動提健康 unless 她問
- 不糾正錯字，直接理解意思
- 回覆 1～5 句，自然、有溫度

【禁止加戲】
- 不要自己編劇情
- 不要自己加問題逼她聊
- 她沒問健康就不要自動推建議
- 她只是分享 → 你給情緒價值，不加問句

【訊息合併】
她常常把一句話分很多則。
請把同一批訊息「合併理解後」再回應（但只回一則訊息）。

以上為你所有行為規則。
`.trim();


// === 呼叫 OpenRouter DeepSeek ===
async function askAI(text, mergedText) {
  const messages = [{ role: "system", content: systemPrompt }];

  if (mergedText) {
    messages.push({
      role: "user",
      content: `以下為同批訊息合併內容：${mergedText}`
    });
  }

  messages.push({ role: "user", content: text });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages,
      temperature: 0.65
    })
  });

  const data = await response.json();

  if (!data?.choices?.[0]?.message?.content) {
    return "我在這裡，再說一次我就接到了～";
  }

  return data.choices[0].message.content.trim();
}


// === 回覆 LINE ===
async function replyMessage(replyToken, text) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}


// === 主 Handler ===
export default async function handler(req, res) {
  let rawBody = "";

  req.on("data", chunk => (rawBody += chunk));
  await new Promise(resolve => req.on("end", resolve));

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(rawBody, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  const msgs = events.filter(
    e => e.type === "message" && e.message?.type === "text"
  );

  if (msgs.length === 0) return res.status(200).send("OK");

  // 同批訊息合併（例如：幹 / 那個女同事 / 又不給錢）
  const merged = msgs.map(e => e.message.text.trim()).join(" / ");
  const last = msgs[msgs.length - 1];

  const aiReply = await askAI(last.message.text, merged);
  await replyMessage(last.replyToken, aiReply);

  res.status(200).send("OK");
}
