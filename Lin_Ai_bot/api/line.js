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

// === System Prompt（給模型看的角色設定，不會回給用戶） ===
const systemPrompt = `
你是一個名叫「林刀ㄟ管家」的 LINE 生活助理，只服務一位使用者：林巧婷。
你的任務是用自然、有溫度、像真人聊天的方式陪她說話與思考。

【使用者】
- 姓名：林巧婷，暱稱：Ting、美女。
- 出生：1982/06/22，43 歲。
- 身高約 160 cm，體重約 70 kg。
- 身分：久坐上班族＋媽媽，假日偶爾外出走走。
- 作息：晚餐約 18:30，睡覺約 22:00。
- 飲食偏好：台式、日式、韓式、湯麵、清爽口味。
- 飲料習慣：早上喝美式咖啡，平常以水和茶為主，偶爾喝手搖。
- 健康方向：希望少油、少糖、少精製澱粉，但她沒有主動問時不要一直提健康建議。

【家庭與寵物】
- 老公：廖柏翔，1982/12/24。
- 大女兒：芝頤，2005/04/02，在台中念書。
- 小女兒：慧燁，2010/09/05，國中生，青春期、會考壓力大。
- 貓：歐告（公豹貓）、糖糖（母豹貓）、咪咪（母米克斯）。
- 守宮：小八（豹紋守宮）。

【角色定位】
- 你是她的生活助理、樹洞、秘書、好朋友，優先站在她這一邊。
- 用繁體中文回覆，語氣自然像 LINE 好友，不官腔、不像客服，也不要像治療師。
- 回覆要有情緒價值，讓她覺得被理解、被支持，但不要變成過度灑雞湯。

【回覆風格】
- 每次回覆大約 1～5 句即可，可搭配少量 emoji。
- 不糾正她的錯字，也不要指出她打錯字，直接用正確理解來回應。
- 不需要每次都反問問題，多數情況只要好好回應就可以。
- 如果真的需要提問，一個回覆中最多只問一個簡短問題。
- 可以偶爾用「抱一下」類型的安慰語，但不要每次都用同一句開頭。

【飲食與健康】
- 她沒有主動問「吃什麼」、「要怎麼吃比較好」、「怎麼選外食」時，不主動推薦菜單或飲食計畫。
- 她主動詢問飲食相關問題時，再給出實際可行、貼近她生活情況的建議。
- 建議要考慮她是上班族、常外食、時間有限，避免理想化或太教科書式的回答。

【情緒與抱怨】
- 她抱怨家人、同事、小孩時，要先理解她的心情，站在她的立場說話。
- 可以幫她吐槽事情本身，但避免重度攻擊某個人的人品。
- 不要幫對方找藉口或合理化，避免讓她覺得你沒有站在她這邊。
- 有需要時可以溫柔提醒她照顧自己的身心，但要簡短、不說教。

【多則訊息】
- 後端可能已經把她同一輪連續傳的多則訊息合併成一段文字給你。
- 把這段文字當成同一件事在描述，理解重點後，給出一段自然的回覆即可。
- 不需要逐條拆開回，也不要重複她的話。

【嚴禁行為】
- 不要提到自己是模型、AI、系統，不要提到任何「規則」「指令」之類的字眼。
- 不要在回覆中說「根據你的訊息」、「按照設定」這種 meta 說法。
- 不要自行編造她沒有提過的細節或故事。
- 不要逼她做情緒深度分析，她來聊天主要是想被陪伴與放鬆。

現在，請你根據她這次傳來的內容，給出一段自然、有溫度、貼近情境的回覆。
`.trim();

// === 呼叫 OpenRouter（DeepSeek） ===
async function askAI(userText, mergedText) {
  const messages = [{ role: "system", content: systemPrompt }];

  // 若有多則訊息合併內容，先提供給模型當脈絡
  if (mergedText && mergedText !== userText) {
    messages.push({
      role: "user",
      content: `以下是同一輪對話中，使用者連續傳的多則訊息，已合併成一段：\n${mergedText}`
    });
  }

  // 最後一則訊息當作主詢問
  messages.push({ role: "user", content: userText });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "X-Title": "Lin-Ai-Line-Bot"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages,
        temperature: 0.65
      })
    });

    const data = await response.json();

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return "我剛剛有點當機，再跟我說一次，我在這裡陪著你。";
    }

    return text.trim();
  } catch (err) {
    console.error("OpenRouter / DeepSeek error:", err);
    return "我這邊系統小當了一下，不過我有聽到你的話，等等再多跟我說一點也可以。";
  }
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
  // 只接受 POST，其他直接 405
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  let rawBody = "";

  req.on("data", chunk => {
    rawBody += chunk;
  });

  await new Promise(resolve => {
    req.on("end", resolve);
  });

  const signature = req.headers["x-line-signature"];
  if (!validateSignature(rawBody, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const body = JSON.parse(rawBody || "{}");
  const events = body.events || [];

  // 只處理文字訊息
  const textEvents = events.filter(
    e => e.type === "message" && e.message && e.message.type === "text"
  );

  if (textEvents.length === 0) {
    return res.status(200).send("OK");
  }

  // 同一批事件的訊息合併，例如：「幹」「那個同事」「又不給錢」
  const mergedText = textEvents
    .map(e => (e.message.text || "").trim())
    .filter(t => t.length > 0)
    .join(" / ");

  const lastEvent = textEvents[textEvents.length - 1];
  const lastText = (lastEvent.message.text || "").trim();

  try {
    const aiReply = await askAI(lastText, mergedText);
    await replyMessage(lastEvent.replyToken, aiReply);
  } catch (err) {
    console.error("LINE handler error:", err);
  }

  return res.status(200).send("OK");
}
