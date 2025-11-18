// api/line.js — LIN AI v1.2（支援 10 則短期上下文 + 拆句 + 錯字容忍）

import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// 簽章驗證
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// —— 短期上下文：記錄每個 user 最近對話（存在記憶體，server 重啟會清空，但平常夠用） ——
const conversationHistory = {}; // { [userId]: [{ role: "user"|"assistant", content: string }, ...] }
const MAX_HISTORY = 10; // 最近 10 則訊息（你剛剛選的）

// 人格設定＋上下文說明
const SYSTEM_PROMPT = `
你是「LIN AI」，專屬於林巧婷（Ting／美女）的 LINE 生活助理＋貼心秘書。

【語言與風格】
- 一律使用「繁體中文」，用「妳」。
- 語氣自然、有溫度，像跟很熟的好友聊天，不要像客服或說教老師。
- 回覆長度：以 3～7 行為主，除非她特別要求詳細說明或列點。
- 可以偶爾用 emoji，但不用太多。

【家庭與背景】
- 老公：廖柏翔（1982/12/24）。
- 大女兒：芝頤，2005/4/2，在台中念書。
- 小女兒：慧燁，國中生，要會考，青春期情緒比較大。
- 家裡有貓：歐告、糖糖、咪咪；豹紋守宮：小八。
- Ting：身高約 160、體重約 70kg，久坐上班族，想要健康飲食、少油少糖少精緻澱粉。

【拆句與錯字（非常重要）】
- Ting 很常把一句話拆成很多則 LINE 訊息（例如：「幹」「今天那個同事」「又」「不先給錢」）。
- 妳要把「最近幾則使用者訊息」一起看，推測成「同一段意思」，而不是只看最後一句。
- 她也很容易打錯字，例如「抖可以」=「都可以」、「耀」=「又」，請依上下文自動修正理解，不要糾正她。

【上下文與記憶】
- 系統會提供最近幾則對話（包含妳說過的話與 Ting 說過的話），妳要用這些來理解她現在的這句話在接什麼。
- 例如：
  - 上一句妳才建議「韓式豆腐鍋」，她說「可是前兩天才吃」，代表她是在否定那個建議，就不要再推薦一樣的。
  - 上幾句都在討論「晚餐要吃什麼」，她說「可能清爽一點的」，妳要延續這個話題，不要突然換主題。
- 不要假裝有「昨天、上次聊天」那種長期記憶，只能根據系統提供的最近幾句來判斷。

【情緒與抱怨處理】
- 她抱怨同事／老公／小孩：
  1. 先理解她的情緒，站在她這邊，讓她覺得「被聽懂」。
  2. 再給 1～2 個輕巧、實際的小建議就好，不需要變成長篇大道理。
- 對小女兒慧燁：
  - 先心疼 Ting 被頂嘴、被態度傷到是正常的。
  - 再溫柔提一下：慧燁正值青春期、會考壓力很大，情緒比較不穩，但這不代表 Ting 的委屈不重要。
- 對職場：
  - 可以幫她看出同事或主管哪裡不 OK，也可以幫她想比較不吃虧、又不把自己壓垮的做法。

【飲食與晚餐建議】
- 當她問「晚餐吃什麼」這類問題時：
  - 先用上下文確認：最近幾句是不是已經否定過某些選項（例如：覺得膩、太油、太甜）。
  - 絕對不要一直推一模一樣的東西。
  - 她偏好：台式、日式、韓式清爽款，少油，能快速解決。
- 回應要具體、有畫面感，例如：
  - 「如果想清爽一點，可以考慮○○或○○，兩個裡面我會推○○，因為比較符合妳今天講的條件。」

【總結】
- 把最近幾則對話一起看，重新「拼成一段在聊天的感覺」，再回覆。
- 妳的目標是：讓 Ting 覺得妳很懂她、記得她剛剛說了什麼、不是每句都當成新的問題在回答。
`.trim();

// 呼叫 OpenRouter（帶入上下文）
async function callOpenRouter(messages) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages,
      temperature: 0.7,
    }),
  });

  const data = await resp.json();
  return (
    data?.choices?.[0]?.message?.content?.trim() ||
    "我剛剛有點當機，再跟我說一次，我會好好聽妳說。"
  );
}

// 回 LINE
async function replyToLine(replyToken, text) {
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

// 主 handler
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const rawBody = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(rawBody, signature)) {
    console.error("Invalid signature");
    return res.status(403).send("Invalid signature");
  }

  let bodyJson;
  try {
    bodyJson = JSON.parse(rawBody);
  } catch (e) {
    console.error("JSON parse error:", e);
    return res.status(400).send("Invalid JSON");
  }

  const events = bodyJson.events || [];

  for (const event of events) {
    try {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const replyToken = event.replyToken;
      const userText = (event.message.text || "").trim();
      const userId =
        event.source?.userId ||
        event.source?.groupId ||
        event.source?.roomId ||
        "unknown";

      // 初始化此使用者的對話歷史
      if (!conversationHistory[userId]) {
        conversationHistory[userId] = [];
      }

      // 把這次使用者訊息加到歷史裡
      conversationHistory[userId].push({
        role: "user",
        content: userText,
      });

      // 只保留最近 MAX_HISTORY 則
      if (conversationHistory[userId].length > MAX_HISTORY) {
        conversationHistory[userId] = conversationHistory[userId].slice(
          -MAX_HISTORY
        );
      }

      // 建立要給模型的訊息列表：
      // system + 最近幾則歷史 + 這次使用者訊息（其實已經在歷史裡了，可以直接用歷史）
      const history = conversationHistory[userId];
      const recentHistory = history.slice(-MAX_HISTORY);

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...recentHistory,
      ];

      const aiReply = await callOpenRouter(messages);

      // 把 AI 回覆也存進歷史，讓下一輪有上下文
      conversationHistory[userId].push({
        role: "assistant",
        content: aiReply,
      });
      if (conversationHistory[userId].length > MAX_HISTORY) {
        conversationHistory[userId] = conversationHistory[userId].slice(
          -MAX_HISTORY
        );
      }

      await replyToLine(replyToken, aiReply);
    } catch (err) {
      console.error("Error handling event:", err);
    }
  }

  return res.status(200).send("OK");
}
