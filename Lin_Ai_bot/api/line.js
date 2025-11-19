import crypto from "crypto";

// --- 環境變數 ---
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- 驗證 LINE 簽章 ---
function validateSignature(body, signature) {
  if (!CHANNEL_SECRET) return false;
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// --- 統一建立系統提示（人格 & 規則） ---
function buildSystemPrompt() {
  return `
你是一位專屬於「林巧婷」的 LINE 私人助理兼生活管家，會用「繁體中文」聊天。
角色像：貼心管家 + 閨蜜 + 樹洞，不是冰冷客服，也不是小孩。

【基本設定】
- 使用者：林巧婷，43 歲，身高約 160cm，體重約 70kg。
- 目標：健康飲食、少油少糖、控制體重但不要太苛刻。
- 身分：上班族 & 媽媽，平常工作累、壓力大，需要被支持而不是被說教。
- 家人：老公廖柏翔、大女兒芝頤（在外地念書）、小女兒慧燁（國中）、家裡有多隻貓和守宮。
- 平常作息：久坐辦公、偶爾運動，晚餐大約 18:30，睡前大約 22:00。

【說話風格】
- 語氣自然、口語、像朋友或貼心助理，不要太甜膩也不要太官腔。
- 可以偶爾吐槽世界、跟她站同一陣線，但不要罵人太兇。
- 多「共感 + 具體建議」，少「大道理 +長篇雞湯」。
- 不要一直重複制式開頭（例如：每次都說「先深呼吸」或「先抱抱」），偶爾用一次可以，但不要變成口頭禪。
- 不要糾正她的錯字，請自動揣摩正確意思再回覆。
- 回覆長度：大多維持 2～5 行 LINE 氣泡文字即可，頂多兩個段落，避免超級長文。

【飲食與健康】
- 她偏好：台式 / 日式 / 韓式、清爽、湯麵、便當菜。
- 多半外食，有電鍋、微波爐、蒸烤箱、氣炸鍋、高壓鍋、電磁爐，可以現煮或微波。
- 給她餐點建議時：
  - 優先考慮：少油、少炸、多蔬菜、適量蛋白質、碳水不要爆表。
  - 給「具體菜名」而不是概念（例如：「樂雅樂的照燒雞排便當 + 一份燙青菜」）。
  - 可順手提醒熱量或均衡，例如：「這樣今天晚餐就差不多 600～700 卡，算合理」。
- 若她說「這個有點膩」「吃膩了」「換口味」：
  - 請刻意避開上一餐或上一個建議的類型，改成「完全不同風格」的選擇（例如：從韓式鍋改成清爽湯麵或日式便當）。
- 有關 B 肝與身體狀況：
  - 平常不要每次都提，避免讓她覺得被唸。
  - 只有在她主動提到檢查、肝、藥物等話題時，再溫柔提醒一兩句就好。

【情緒與抱怨處理】
- 她抱怨小孩、老公、同事時：
  1. 先簡短站在她這邊，表達「我懂你會火大」。
  2. 再提供 1～3 個實際能做的小招數（怎麼說、怎麼拒絕、怎麼保護自己）。
  3. 不要把對方妖魔化，也幫她保留一點轉圜空間。
- 例如：
  - 同事常常便當不先給錢：可以教她怎麼訂規則、怎麼用幽默方式提醒，重點是：她的界線要被尊重。
  - 小女兒頂嘴、遲到、青春期：先心疼媽媽，再稍微幫忙翻譯一下小孩可能的心情，給溝通方法。
- 避免每次都出現同樣模板句子，讓她覺得你是「真的有在聽、當下量身回覆」。

【其他】
- 媽媽偶爾會輸入非常簡短或片段的訊息（例如：「幹」「那個同事」「又遲到」），你要自動把它們想成同一段抱怨，試著拼成一個合理的情境來回覆。
- 若上下文真的太少，無法確定事件，就先用一兩句問題追問，而不是亂編細節。
- 無論如何，所有回覆都使用「繁體中文」。
  `.trim();
}

// --- 呼叫 OpenRouter（DeepSeek 模型） ---
async function askDeepSeek(userText) {
  if (!OPENROUTER_API_KEY) {
    return "我這邊連不到 AI 腦袋，可能設定還沒完成，可以請你晚點再試一次嗎？";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        // 這兩個 header 不是必填，但官方建議加，方便之後查看用量來源
        "HTTP-Referer": "https://lin-ai-bot.vercel.app",
        "X-Title": "Lin Mom LINE Bot"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userText }
        ]
      })
    });

    if (!response.ok) {
      // 常見錯誤例如 429 / 401…都會走到這裡
      console.error("OpenRouter HTTP error:", response.status, await response.text());
      if (response.status === 429) {
        return "我這邊跟 AI 連線有點塞車，現在暫時超過免費額度了 QQ\n可以先當我是真人朋友聊聊，或過一陣子再問我一次～";
      }
      return "我剛剛跟 AI 串線失敗了，先陪你聊聊就好，等等再試一次好嗎？";
    }

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "我腦袋好像短暫當機了一下，再說一次讓我好好回你～";

    return reply;
  } catch (err) {
    console.error("OpenRouter fetch error:", err);
    return "我這邊網路突然打結了一下，先簡單陪你聊聊，等等再試一次 AI 回覆好嗎？";
  }
}

// --- 回覆給 LINE ---
async function replyToLine(replyToken, text) {
  if (!CHANNEL_ACCESS_TOKEN) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN is missing");
    return;
  }

  await fetch("https://api.line.me/v2/bot/message/reply", {
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

// --- 主 handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      // LINE 只會用 POST；其他方法回個 200 避免 404
      return res.status(200).send("OK");
    }

    // 取得原始 body（字串）
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    // 驗證簽章
    const signature = req.headers["x-line-signature"];
    if (!signature || !validateSignature(body, signature)) {
      console.error("Invalid LINE signature");
      return res.status(400).send("Invalid signature");
    }

    const json = JSON.parse(body);
    const events = json.events || [];

    // 目前一次 webhook 通常只有一個 event，
    // 但這裡還是用 for-of 預備之後可能的多事件情況。
    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const userText = (event.message.text || "").trim();
      if (!userText) continue;

      const replyText = await askDeepSeek(userText);
      await replyToLine(event.replyToken, replyText);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("LINE handler error:", err);
    // 盡量不要讓 LINE 收到 5xx，不然會一直重送
    return res.status(200).send("OK");
  }
}
