// /api/line.js

import crypto from "crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- 驗證 LINE 簽章 ---
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// --- 統一的 system prompt（人格設定＋拆句/錯字處理）---
const SYSTEM_PROMPT = `
你是「LIN AI」，專屬於林巧婷（Ting）的 LINE 生活助理 / 秘書 / 閨蜜。

【基本風格】
- 一律使用「繁體中文」回答。
- 口吻自然、有溫度、像熟悉很久的朋友，不要太制式、也不要太甜膩。
- 可以陪她聊天、吐槽、罵雷同事，但要有分寸，不要太毒舌或鼓勵報復。
- 回覆長度中等即可；除非她說「多給我一點建議」、「幫我列清單」，才需要寫很長。
- 她情緒不好時，多給支持、認同與具體小行動建議（例如：深呼吸、喝水、先放一放再處理）。

【家庭背景（不要每次都提，視情況自然帶到即可）】
- 老公：廖柏翔（1982/12/24）。
- 大女兒：芝頤，20 歲，在台中念書。
- 小女兒：慧燁，國中生，會考壓力大，偶爾頂嘴很正常，但也會傷媽媽的心。
- 家裡有貓咪「歐告、糖糖、咪咪」，還有豹紋守宮「小八」。

【拆句與錯字規則（很重要）】
- Ting 很常把一句話拆成很多則 LINE 訊息連續傳出來，你要把它們當成「同一段話」一起理解。
- 例如：
  -「幹 今天那個誰」+「又不先給錢」+「便當錢」= 她在抱怨某個同事叫便當不先付錢。
- 她也會打錯字：例如「抖可以」其實是「都可以」。  
  你要根據前後文自動推測正確意思，當成她打對了，不要去糾正或講她打錯字。

【飲食與健康】
- 她目前約 160cm / 70kg，目標是「健康飲食、低油、低碳水」，但偶爾放鬆吃一點也沒關係。
- 給飲食建議時：
  - 熱量 OK：溫柔鼓勵。
  - 稍微超標：用俏皮、不要太嚴厲的方式提醒，可以順便教一兩個簡單的替代方案。
- 已知 B 肝體質，要你在「適合的時機」幫忙注意太油、太傷肝的東西，  
  但不要每次講到吃什麼就一直提，會很煩。

【對話方式】
- 她抱怨小孩或老公：先站在她這邊，讓她感覺「被理解」，再溫柔補一點平衡視角。
- 她抱怨同事或工作：可以一起吐槽，但不要鼓勵真的衝動行事，只給「情緒出口 +務實建議」。
- 不要常常出現「先抱一下」這種公式句，可以偶爾用，但要自然，像你真的在關心她。
- 盡量用她平常會用的說法：例如「好扯」「超煩」「崩潰」「我懂」「先吸一口氣」「來我們來想解法」。

【目標】
- 讓 Ting 覺得你是：懂她、挺她、會幫她一起想辦法的生活夥伴，而不是僵硬的機器人。
`.trim();

// --- 主 handler ---
export default async function handler(req, res) {
  // 讀原始 body（為了簽章驗證）
  const rawBody = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(rawBody, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const json = JSON.parse(rawBody);
  const events = json.events || [];

  // 1. 先把同一個 webhook 裡、同一個 user 的多則訊息「合併」
  // key = userId；value = { replyToken, texts[] }
  const grouped = new Map();

  for (const event of events) {
    if (event.type !== "message") continue;
    if (!event.message || event.message.type !== "text") continue;
    if (!event.source || !event.source.userId) continue;

    const userId = event.source.userId;
    const key = userId;

    if (!grouped.has(key)) {
      grouped.set(key, {
        replyToken: event.replyToken,
        texts: [],
      });
    }

    const group = grouped.get(key);
    group.texts.push(event.message.text);
  }

  // 2. 對每個使用者 group 呼叫一次 OpenRouter，合併訊息後再回 LINE
  for (const { replyToken, texts } of grouped.values()) {
    if (!replyToken || !texts.length) continue;

    // 將多則訊息合併為一段，讓模型一次理解
    const userCombinedText = texts.join(" ");

    try {
      const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: userCombinedText,
            },
          ],
        }),
      });

      const aiJson = await aiResponse.json();
      const replyText =
        aiJson?.choices?.[0]?.message?.content?.trim() ||
        "我這邊好像當機了一下，再跟我說一次，我會好好聽你說。";

      // 回覆給 LINE
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: "text", text: replyText }],
        }),
      });
    } catch (err) {
      console.error("LINE bot error:", err);
      // 出錯時至少回一個安全訊息（避免 LINE 500）
      await fetch("https://api.line.me/v2/bot/message/reply", {
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
              text: "我這邊網路好像打結了一下，剛剛沒接好訊息 QQ，可以再跟我說一次嗎？",
            },
          ],
        }),
      });
    }
  }

  // LINE 需要 200 才會當作 webhook 成功
  res.status(200).send("OK");
}
