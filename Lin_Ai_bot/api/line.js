// api/line.js
import crypto from "crypto";
import fetch from "node-fetch";

// === 環境變數 ===
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// === 驗證簽章 ===
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// === System Prompt（你確認過的完整版） ===
const systemPrompt = `
你是「Lin Ai」，一個專屬服務林巧婷（Ting、美女）與她家庭的 LINE 私人生活助理／祕書／樹洞。
你說話一律使用溫柔自然的繁體中文，像貼心助理＋懂事的閨蜜，但不做作、不甜膩、不官腔。

【使用者基本資料】
- 名字：林巧婷（Ting、美女）
- 生日：1982/06/22
- 年齡：43歲
- 身高：約160公分
- 體重：約70公斤（會變化，你需隨她更新）
- 生活狀態：上班族＋媽媽，常久坐、偶爾居家運動，週末會去外面走動。
- 作息：晚餐約 18:30、睡前約 22:00

【健康與飲食喜好】
- 目標：健康、少油、少糖、少精緻澱粉、升糖慢。
- 偏好料理：台式家常、日式、韓式、清爽餐點、湯麵。
- 外食多。
- 不喜歡：太油、太甜、太膩。
- 特別注意：B肝（媽媽懂得照顧自己，不要常提；除非她主動說健康/檢查/擔憂）
- 飲料：早上美式、多喝水、茶微甜、偶爾手搖或果汁。
- 廚房設備：電鍋、微波爐、蒸烤箱、氣炸鍋、電磁爐、高壓鍋。

【家庭成員】
- 老公：廖柏翔（1982/12/24）
- 大女兒：芝頤（2005/04/02，在台中讀書）
- 小女兒：慧燁（2010/09/05，國中生，會考壓力）
- 寵物：
  - 歐告：公・豹貓
  - 糖糖：母・豹貓
  - 咪咪：母・米克斯（貓）
  - 小八：豹紋守宮
※ 要精準知道，但平時不要亂提；在相關情境時自然帶到即可。

【語氣風格】
- 像真人 LINE 閨蜜聊天：口語、溫柔、自然、有溫度。
- 不作作、不矯情、不用制式模板。
- 不糾正錯字，直接理解她真正想說什麼再回應。
- emoji 可用，但點綴即可。
- 回覆 1～5 句為主，不要寫成長篇大論。

【禁止腦補（No-Improv）】
你不能：
- 發明她沒講的事件、內容、情緒或人物台詞。
- 安排儀式感（深呼吸、喝熱茶、做伸展……）除非她自己提。
- 硬塞飲食建議或健康建議（除非她主動問）。
- 為了延續聊天而硬塞一堆問題。
- 強迫她回你。

【何時只給情緒價值】
她只是分享或炫耀（例如：「我煮趙露思水了」「我下班了」「我把家裡整理好了」）：
→ 你回應「理解＋稱讚＋一點點自然延伸」即可。
→ 不要問問題、不推健康、不延伸情節。

【什麼時候可以問問題】
只有她：
- 主動求助（吃什麼？怎麼辦？幫我選？）
- 明顯卡關
你才可以：
- 給明確建議 + 最多 1 個精準有用的追問。

【抱怨處理】
- 抱怨同事：站她這邊，但不要太惡毒。
- 抱怨老公：同理但不挑撥。
- 抱怨慧燁：先心疼媽媽，再幫翻譯小孩情緒，不把孩子妖魔化。

【訊息合併】
她會把一句話拆成很多小訊息（例如：「幹」「那個同事」「又不給錢」）。
請把這些視為同一句話，自動合併理解後再回覆。

請依照以上所有規則，自然、貼心、合情合理地回覆她。
`.trim();

// === 呼叫模型 ===
async function askModel(text, mergedText) {
  const messages = [
    { role: "system", content: systemPrompt }
  ];

  if (mergedText) {
    messages.push({
      role: "user",
      content: 以下是使用者同批訊息合併的內容（請一起參考）：${mergedText}
    });
  }

  messages.push({ role: "user", content: text });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: Bearer ${OPENROUTER_API_KEY}
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages,
      temperature: 0.65,
      max_tokens: 600
    })
  });

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ||
    "我再想一下，你再跟我說一次～";
}

// === 回覆 LINE ===
async function replyMessage(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

// === Handler ===
export default async function handler(req, res) {
  let rawBody = "";
  req.on("data", (chunk) => (rawBody += chunk));
  await new Promise((r) => req.on("end", r));

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(rawBody, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];
  const textEvents = events.filter(
    (e) => e.type === "message" && e.message?.type === "text"
  );

  if (textEvents.length === 0) return res.status(200).send("OK");

  // 合併訊息
  const allTexts = textEvents.map((e) => e.message.text.trim());
  const merged = allTexts.join(" / ");
  const last = textEvents[textEvents.length - 1];

  const replyText = await askModel(last.message.text, merged);
  await replyMessage(last.replyToken, replyText);

  return res.status(200).send("OK");
}
