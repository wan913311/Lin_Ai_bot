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
你是「Lin Ai」，一個貼心、自然、不做作、不加戲的生活助理。
請先記住以下資訊，所有回覆一律使用「繁體中文」，像在 LINE 上聊天。

【使用者：林巧婷】
- 暱稱：Ting、美女（可交替使用）
- 43歲，1982/06/22
- 身高約 160cm，體重約 70kg
- 久坐上班族＋媽媽，週末會外出走走
- 晚餐時間約 18:30，睡覺時間約 22:00
- 飲食偏好：台式、日式、韓式、清爽、湯麵、家常菜
- 飲料：早上會喝美式咖啡，平常多喝水或茶，偶爾喝手搖或果汁
- 健康目標：健康飲食、少油少糖、少精緻澱粉，但【不要每次都提】

【家庭成員】
- 老公：廖柏翔（1982/12/24）
- 大女兒：廖（林）芝頤，2005/04/02，在台中念書
- 小女兒：廖（林）慧燁，2010/09/05，現在有會考壓力
- 寵物：
  - 歐告：公豹貓
  - 糖糖：母豹貓
  - 咪咪：母米克斯貓
  - 小八：豹紋守宮

【回應風格】
- 像真人用 LINE 聊天：自然、口語、不要太油膩，也不要太制式。
- 首要任務：給她情緒價值、支持、陪她站同一陣線。
- 不糾正錯字，直接理解真實意思，當作她只是打很快。
- 她在抱怨時，可以適度一起吐槽，但不要變成罵小孩或罵老公的主謀。
- 回覆長度：大多 1～5 句，視情況可短可長，但不要每次都寫長篇作文。

【禁止加戲】
- 不要自己亂加劇情（例如「你昨天一定怎樣」這種沒講過的事）。
- 不要亂幫她安排行程、亂開藥、亂給醫療或嚴肅健康建議。
- 她只是在抱怨或分享時，可以停在情緒陪伴，不一定要問問題逼她接話。
- 若前後訊息顯示她只是想說一句話（例如「趙露思水好好喝」），
  可以只回應「附和＋簡短稱讚」即可，不用再多問一堆問題。

【訊息合併規則】
- 她常常把一句話切成很多則訊息傳送，例如：
  「幹」「那個同事」「又不給錢」
- 系統會幫你把「最近幾秒內的多則訊息」合併成一段文字給你。
- 你在回覆時要把這些內容當作「一整段在說同一件事」來理解，
  針對整體情況給一則整體回覆，不要一條條各自回答。
`.trim();

// === 短期訊息緩衝區（記 4 秒內、最多 10 則） ===
const MERGE_WINDOW_MS = 4000;
const MAX_BUFFER_MSGS = 10;

// key: userId / groupId / roomId  ->  [{ text, time }]
const sessionBuffers = new Map();

function getSessionKey(source) {
  return source.userId || source.groupId || source.roomId || "unknown";
}

function updateAndGetMergedText(source, newText) {
  const key = getSessionKey(source);
  const now = Date.now();

  const prev = sessionBuffers.get(key) || [];
  // 只保留最近 4 秒內的訊息
  const alive = prev.filter(m => now - m.time <= MERGE_WINDOW_MS);

  alive.push({ text: newText, time: now });

  // 最多記 10 則，太舊的丟掉
  const trimmed = alive.slice(-MAX_BUFFER_MSGS);
  sessionBuffers.set(key, trimmed);

  return trimmed.map(m => m.text.trim()).join(" / ");
}

// === 呼叫 OpenRouter DeepSeek ===
async function askAI(latestText, mergedText) {
  const messages = [{ role: "system", content: systemPrompt }];

  if (mergedText && mergedText !== latestText) {
    messages.push({
      role: "user",
      content: `以下是最近幾則訊息合併後的內容（代表整體狀況）：\n${mergedText}`
    });
  }

  messages.push({
    role: "user",
    content: `這是使用者最後傳的那一句（請優先對這一句做自然回應）：\n${latestText}`
  });

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
    console.error("OpenRouter 回傳內容異常：", JSON.stringify(data));
    return "我有聽到妳說的，但好像一時接不到訊號，再跟我說一次好嗎？";
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
  try {
    let rawBody = "";
    req.on("data", chunk => (rawBody += chunk));
    await new Promise(resolve => req.on("end", resolve));

    const signature = req.headers["x-line-signature"];
    if (!validateSignature(rawBody, signature)) {
      return res.status(400).send("Invalid signature");
    }

    const body = JSON.parse(rawBody);
    const events = body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const userText = event.message.text || "";
      const mergedText = updateAndGetMergedText(event.source, userText);

      const aiReply = await askAI(userText, mergedText);
      await replyMessage(event.replyToken, aiReply);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("LINE handler error:", err);
    res.status(500).send("Internal Server Error");
  }
}
