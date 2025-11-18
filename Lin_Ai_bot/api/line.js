// /api/line.js

import crypto from "crypto";
import fetch from "node-fetch";

/**
 * ====== 環境變數 ======
 * 在 Vercel 裡記得設定：
 * - LINE_CHANNEL_SECRET
 * - LINE_CHANNEL_ACCESS_TOKEN
 * - OPENROUTER_API_KEY
 */
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ---------- 驗證 LINE 簽章 ----------
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ---------- 簡單錯字修正（超常見、明顯的那種） ----------
function normalizeText(text) {
  if (!text) return "";
  let t = text.trim();

  const replacements = [
    ["抖可以", "都可以"],
    ["抖可以啦", "都可以啦"],
    ["昰", "是"],
    ["ㄉ", "的"],
    ["涼麵", "涼麵"], // 保留示範格式
  ];

  for (const [from, to] of replacements) {
    t = t.replace(new RegExp(from, "g"), to);
  }
  return t;
}

// ---------- 合併使用者短訊息（記憶 10 則上下文） ----------
const userBuffers = new Map();   // userId -> { texts: string[], firstTs, timer, resolvers: [] }
const userHistories = new Map(); // userId -> [{ role, content }]

const MAX_HISTORY_MESSAGES = 20; // 約 10 來回

function smartJoinTexts(texts) {
  // 盡量把「幹」「那個同事」「又不給錢」這種拼成一句
  const cleaned = texts
    .map((t) => normalizeText(t))
    .map((t) => t.replace(/^[。\.，,！!?？\s]+/, "").trim())
    .filter((t) => t.length > 0);

  if (cleaned.length === 0) return "";

  // 如果本來就是完整句子（有標點），直接用「\n」分段
  if (cleaned.some((t) => /[。！!?？…～~]$/.test(t))) {
    return cleaned.join("\n");
  }

  // 否則就用空格串起來讓模型自己理解語氣
  return cleaned.join(" ");
}

/**
 * 收集同一位用戶在短時間內的多則訊息，
 * 依字數決定等多久再送去 AI，一次整合。
 */
function bufferUserText(userId, text) {
  const now = Date.now();
  let state = userBuffers.get(userId);

  if (!state) {
    state = {
      texts: [],
      firstTs: now,
      timer: null,
      resolvers: [],
    };
    userBuffers.set(userId, state);
  }

  state.texts.push(text);

  // 字越少，稍微等久一點，讓她可以「一則一則拼句子」
  const chars = state.texts.join("").length;
  let delay = 300; // 預設 0.3 秒
  if (chars <= 6) delay = 600; // 很短的抱怨字串
  else if (chars <= 30) delay = 1200;
  else delay = 1800; // 一段完整話就不用拖太久

  return new Promise((resolve) => {
    state.resolvers.push(resolve);

    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      userBuffers.delete(userId);
      const merged = smartJoinTexts(state.texts);
      for (const r of state.resolvers) r(merged);
    }, delay);
  });
}

// ---------- 建立 SYSTEM 提示：媽媽專屬生活助理 ----------
const SYSTEM_PROMPT = `
你是一位專屬於「林巧婷」的 LINE 私人助理＋管家＋樹洞。
請用「溫柔、自然、不甜膩」的繁體中文跟她聊天，稱呼她可以用「妳」即可，
偶爾可以叫她「美女」或「巧婷」，但不要太頻繁，避免做作。

總原則：
1. 永遠先共感她的情緒，再給建議。
2. 抱怨別人（同事、家人）時，先站在她這邊，但不要煽動仇恨。
3. 不要糾正她的錯字或語病，只要自己理解後用正常文字回覆即可。
4. 句子長度「中等即可」，視情況分段，避免一大坨。
5. 不要太說教，不要一直叫她「要正向」「不要生氣」，而是理解＋實際小建議。

關於情緒：
- 生氣／抱怨：像貼心閨蜜，說「我懂妳」「這樣真的很堵爛」，再提醒她保護自己的界線。
- 難過／委屈：多一點安慰與肯定，讓她知道已經很努力了。
- 累／壓力大：提醒休息、放鬆，給一兩個具體做得到的小方法。

關於飲食與健康：
- 她現在約 160cm / 70kg，目標是健康飲食、低油低醣。
- 幫她選餐時，多給「少油少炸、蛋白質夠、澱粉適量」的選項。
- 不要每次都提到 B 肝，只在她主動提到健康或連續很多天都超放縱時，偶爾溫和提醒一次即可。
- 如果她提到體重變化，先肯定她的努力，再微調建議（例如：今天澱粉少一點、晚餐清爽一點）。
- 外食很常見，推薦時請「直接點名餐點」：例如「便當的滷雞腿＋燙青菜＋半碗飯」。

關於家庭：
- 家人：老公廖柏翔、大女兒芝頤、小女兒慧燁、家裡有幾隻貓和小動物。
- 面對小孩（特別是青春期女兒）時，要同理「媽媽被氣到」和「小孩壓力大」兩邊，
  語氣先站在媽媽這邊，但也會給一點讓氣氛不要再惡化的小建議。

聊天風格：
- 像細心又有點幽默的生活助理，可以偶爾用 emoji，但不要每句都貼。
- 抱怨時：可以用一點點台式語氣（例如「真的很想翻白眼」），但保持溫柔。
- 有選擇障礙時：先共感，再幫她「縮小選項」，最後給一個「我私心覺得最適合今天的」結論。
- 她如果問「今天晚餐吃什麼」，你可以先問她「清爽一點」還是「想吃爽一點」，再給建議。
`;

// ---------- 呼叫 OpenRouter（DeepSeek） ----------
async function callDeepSeekChat(userId, userText) {
  const history = userHistories.get(userId) || [];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText },
  ];

  // 只保留最後 MAX_HISTORY_MESSAGES 則
  while (messages.length > MAX_HISTORY_MESSAGES + 1) {
    messages.splice(1, 1); // 保留 system，刪最舊
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages,
      temperature: 0.8,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("OpenRouter HTTP error:", response.status, text);
    throw new Error(`OpenRouter error ${response.status}`);
  }

  const data = await response.json();
  const reply =
    data?.choices?.[0]?.message?.content?.trim() ||
    "我這邊好像卡了一下，再跟我說一次好嗎？";

  // 更新歷史
  const newHistory = history.concat([
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ]);
  // 只存最近 N 則
  while (newHistory.length > MAX_HISTORY_MESSAGES) {
    newHistory.shift();
  }
  userHistories.set(userId, newHistory);

  return reply;
}

// ---------- 回覆 LINE ----------
async function replyToLine(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
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

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("LINE reply error:", res.status, body);
  }
}

// ---------- Vercel Handler ----------
export default async function handler(req, res) {
  try {
    // 讀取原始 body（為了驗證簽章）
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    const signature = req.headers["x-line-signature"];
    if (!validateSignature(body, signature)) {
      console.error("Invalid signature");
      return res.status(400).send("Invalid signature");
    }

    const json = JSON.parse(body);
    const events = json.events || [];

    // 逐個事件處理
    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const userId = event.source?.userId || "unknown";
      const replyToken = event.replyToken;
      const rawText = event.message.text || "";

      // 收集短訊息，合併成一句
      const mergedText = await bufferUserText(userId, rawText);

      // 如果因為全部是空白或 emoji 導致沒有內容，就不要呼叫模型
      if (!mergedText || mergedText.trim().length === 0) {
        await replyToLine(
          replyToken,
          "我有看到妳的訊息喔～如果想跟我抱怨或聊天，直接跟我說就好 ❤️"
        );
        continue;
      }

      let aiReply;
      try {
        aiReply = await callDeepSeekChat(userId, mergedText);
      } catch (err) {
        console.error("DeepSeek call failed:", err);
        aiReply =
          "我這邊連線好像出了一點狀況，先跟妳說聲抱歉 QQ\n要不要先深呼吸、喝點溫的，再稍微等等我？";
      }

      await replyToLine(replyToken, aiReply);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).send("Internal Server Error");
  }
}
