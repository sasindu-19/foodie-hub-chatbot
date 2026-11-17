require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const Groq = require("groq-sdk");
const { GoogleGenAI } = require("@google/genai"); // Added Gemini SDK

// ─────────────────────────────────────────────
// 1. INITIALIZATIONS (FIREBASE, GROQ & GEMINI)
// ─────────────────────────────────────────────
const serviceAccount = require("./firebase-key.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); // Initialize Gemini

// ─────────────────────────────────────────────
// 2. WHATSAPP CLIENT INITIALIZATION
// ─────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
    strict: false,
  },
});

client.on("qr", (qr) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🍔  FOODIE HUB BOT — QR CODE READY  🍔  ");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  qrcode.generate(qr, { small: true });
  console.log("\n📱 Scan with WhatsApp Business App to activate the bot...\n");
});

client.on("ready", () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  FOODIE HUB BOT IS LIVE & CONNECTED! 🚀🔥  ");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Loading: ${percent}% - ${message}`);
});

client.on("authenticated", () => {
  console.log("🔑 Authenticated successfully!");
});

client.on("auth_failure", () => {
  console.error("❌ Authentication failed! Please delete .wwebjs_auth folder and restart.");
});

client.on("disconnected", (reason) => {
  console.warn("⚠️  Bot disconnected:", reason);
});

// ─────────────────────────────────────────────
// 3. HELPER UTILITIES
// ─────────────────────────────────────────────
function getGreeting() {
  const hour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })).getHours();
  if (hour >= 5 && hour < 12) return "🌅 Good Morning";
  if (hour >= 12 && hour < 17) return "☀️ Good Afternoon";
  if (hour >= 17 && hour < 21) return "🌇 Good Evening";
  return "🌙 Good Night";
}

function getTimestamp() {
  return new Date().toLocaleString("en-LK", {
    timeZone: "Asia/Colombo",
    dateStyle: "full",
    timeStyle: "short",
  });
}

function formatLKR(amount) {
  return `LKR ${Number(amount).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─────────────────────────────────────────────
// 4. FIREBASE DATA FETCHERS
// ─────────────────────────────────────────────
async function getSystemSummary() {
  try {
    const [menuSnapshot, ordersSnapshot, usersSnapshot] = await Promise.all([
      db.collection("menuItems").get(),
      db.collection("orders").get(),
      db.collection("users").get(),
    ]);

    let totalIncome = 0;
    let completedOrders = 0;
    let pendingOrders = 0;
    let cancelledOrders = 0;

    ordersSnapshot.forEach((doc) => {
      const data = doc.data();
      const status = (data.status || "").toLowerCase();
      const price = Number(data.totalPrice || 0);

      if (status === "completed") {
        completedOrders++;
        totalIncome += price;
      } else if (status === "pending" || status === "processing") {
        pendingOrders++;
      } else if (status === "cancelled") {
        cancelledOrders++;
      }
    });

    const activeMenuItems = menuSnapshot.docs.filter(doc => doc.data().available !== false).length;

    return {
      success: true,
      totalMenuItems: menuSnapshot.size,
      activeMenuItems,
      totalOrders: ordersSnapshot.size,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      totalUsers: usersSnapshot.size,
      totalIncome,
    };
  } catch (error) {
    console.error("❌ Firebase Fetch Error:", error);
    return { success: false, error: error.message };
  }
}

async function getRecentOrders() {
  try {
    const snapshot = await db.collection("orders").orderBy("createdAt", "desc").limit(5).get();
    const orders = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      orders.push({
        id: doc.id.slice(-6).toUpperCase(),
        status: d.status || "unknown",
        total: Number(d.totalPrice || 0),
        items: d.items ? d.items.length : "?",
      });
    });
    return { success: true, orders };
  } catch (error) {
    console.error("❌ Recent Orders Fetch Error:", error);
    return { success: false, error: error.message };
  }
}

async function getMenuItems() {
  try {
    const snapshot = await db.collection("menuItems").get();
    const items = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      items.push({
        id: doc.id,
        name: data.name || "Unnamed Item",
        price: Number(data.price || 0),
        category: data.category || "Other",
        available: data.available !== false,
        description: data.description || "No description available.",
        allergens: data.allergens || "None",
        imageUrl: data.imageUrl || null,
      });
    });

    items.sort((a, b) => {
      const catA = a.category.toUpperCase();
      const catB = b.category.toUpperCase();
      if (catA < catB) return -1;
      if (catA > catB) return 1;
      const nameA = a.name.toUpperCase();
      const nameB = b.name.toUpperCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    return { success: true, items };
  } catch (error) {
    console.error("❌ Menu Items Fetch Error:", error);
    return { success: false, error: error.message };
  }
}

// Dynamic context generator for Gemini
async function getDatabaseContextForAI() {
  try {
    const [menuSnapshot, ordersSnapshot, usersSnapshot] = await Promise.all([
      db.collection("menuItems").get(),
      db.collection("orders").get(),
      db.collection("users").get(),
    ]);

    let totalIncome = 0;
    let completedOrders = 0;
    let pendingOrders = 0;
    let cancelledOrders = 0;
    let itemSalesCount = {};

    // Today's date string in Asia/Colombo timezone (e.g. "6/26/2026")
    const todayStr = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Colombo" });

    let todayOrdersCount = 0;
    let todayCompletedOrders = 0;
    let todayPendingOrders = 0;
    let todayCancelledOrders = 0;
    let todayIncome = 0;

    ordersSnapshot.forEach((doc) => {
      const data = doc.data();
      const status = (data.status || "").toLowerCase();
      const price = Number(data.totalPrice || 0);

      // Check if order was created today
      const orderDate = data.createdAt ? data.createdAt.toDate() : null;
      const isToday = orderDate && orderDate.toLocaleDateString("en-US", { timeZone: "Asia/Colombo" }) === todayStr;

      if (isToday) {
        todayOrdersCount++;
        if (status === "completed") {
          todayCompletedOrders++;
          todayIncome += price;
        } else if (status === "pending" || status === "processing") {
          todayPendingOrders++;
        } else if (status === "cancelled") {
          todayCancelledOrders++;
        }
      }

      if (status === "completed") {
        completedOrders++;
        totalIncome += price;

        // Track item sales for popularity
        if (data.items && Array.isArray(data.items)) {
          data.items.forEach(item => {
            const name = item.name || "Unknown Item";
            itemSalesCount[name] = (itemSalesCount[name] || 0) + (item.quantity || 1);
          });
        }
      } else if (status === "pending" || status === "processing") {
        pendingOrders++;
      } else if (status === "cancelled") {
        cancelledOrders++;
      }
    });

    // Find most popular item
    let popularItem = "No orders yet";
    let maxSales = 0;
    for (const [item, count] of Object.entries(itemSalesCount)) {
      if (count > maxSales) {
        maxSales = count;
        popularItem = `${item} (${count} units sold)`;
      }
    }

    const menuItemsList = [];
    menuSnapshot.forEach(doc => {
      menuItemsList.push(`${doc.data().name} - ${formatLKR(doc.data().price)} (${doc.data().available !== false ? 'Available' : 'Unavailable'})`);
    });

    return {
      totalUsers: usersSnapshot.size,
      totalIncome: formatLKR(totalIncome),
      totalOrders: ordersSnapshot.size,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      popularItem,
      menuItemsList: menuItemsList.join(", "),
      // Today's metrics
      todayOrdersCount,
      todayCompletedOrders,
      todayPendingOrders,
      todayCancelledOrders,
      todayIncome: formatLKR(todayIncome)
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ─────────────────────────────────────────────
// 5. MESSAGE BUILDERS
// ─────────────────────────────────────────────
function buildMainMenu() {
  return (
    `╔═══════════════════════════════╗\n` +
    `║  🍔  *FOODIE HUB ADMIN BOT* 🍔  ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `${getGreeting()}, Admin! 👋\n` +
    `_${getTimestamp()}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *AVAILABLE COMMANDS:*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*1️⃣  → Full System Summary*\n` +
    `    📊 Users, Menu, Orders & Income\n\n` +
    `*2️⃣  → Recent Orders*\n` +
    `    🧾 Last 5 orders placed\n\n` +
    `*3️⃣  → View Menu Items*\n` +
    `    🍔 List of food items by category\n\n` +
    `*0️⃣  → Show This Menu Again*\n` +
    `    🔄 Display all commands\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Reply with a number to continue_ 👆`
  );
}

function buildSummaryReport(report) {
  const completionRate = report.totalOrders > 0 ? ((report.completedOrders / report.totalOrders) * 100).toFixed(1) : 0;
  return (
    `╔═══════════════════════════════╗\n` +
    `║  📊  *FOODIE HUB — SYSTEM REPORT* ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `🕐 _${getTimestamp()}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 *USERS & MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 Registered Users:      *${report.totalUsers}*\n` +
    `🍔 Total Menu Items:      *${report.totalMenuItems}*\n` +
    `✅ Active Items:           *${report.activeMenuItems}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 *ORDERS OVERVIEW*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 Total Orders:          *${report.totalOrders}*\n` +
    `✅ Completed:              *${report.completedOrders}*\n` +
    `⏳ Pending / Processing:  *${report.pendingOrders}*\n` +
    `❌ Cancelled:              *${report.cancelledOrders}*\n` +
    `📈 Completion Rate:       *${completionRate}%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *FINANCIALS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 All-Time Revenue:  *${formatLKR(report.totalIncome)}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Reply *0* to return to menu_ 🔄`
  );
}

function buildRecentOrders(data) {
  if (!data.orders || data.orders.length === 0) return "📭 *No recent orders found.*\n\n_Reply *0* to return to menu_ 🔄";
  const statusEmoji = { completed: "✅", pending: "⏳", processing: "🔄", cancelled: "❌" };
  let msg = `╔═══════════════════════════════╗\n║  🧾  *RECENT ORDERS (Last 5)* ║\n╚═══════════════════════════════╝\n\n🕐 _${getTimestamp()}_\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  data.orders.forEach((order, i) => {
    const emoji = statusEmoji[order.status.toLowerCase()] || "📋";
    msg += `\n*Order ${i + 1} — #${order.id}*\n${emoji} Status:  *${order.status.toUpperCase()}*\n🛍️  Items:    *${order.items}*\n💵 Total:    *${formatLKR(order.total)}*\n━━━━━━━━━━━━━━━━━━━━━━━━`;
  });
  msg += "\n\n_Reply *0* to return to menu_ 🔄";
  return msg;
}

function buildMenuItemsList(data) {
  if (!data.items || data.items.length === 0) return "📭 *No menu items found.*\n\n_Reply *0* to return to menu_ 🔄";
  let msg = `╔═══════════════════════════════╗\n║  🍔  *FOODIE HUB — MENU ITEMS* ║\n╚═══════════════════════════════╝\n\n🕐 _${getTimestamp()}_\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  let currentCategory = "";
  data.items.forEach((item, index) => {
    const cat = (item.category || "Other").toUpperCase();
    if (cat !== currentCategory) {
      if (currentCategory !== "") msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n*📂 ${cat}*\n`;
      currentCategory = cat;
    }
    const statusEmoji = item.available ? "✅" : "❌";
    msg += `*${index + 1}.* ${item.name} — *${formatLKR(item.price)}* ${statusEmoji}\n`;
  });
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n👉 Reply with *show <number>* (e.g., *show 1*) to view picture & details.\n\n_Reply *0* to return to menu_ 🔄`;
  return msg;
}

function buildItemDetails(item, index) {
  const statusEmoji = item.available ? "✅ Available" : "❌ Unavailable";
  return (
    `╔═══════════════════════════════╗\n` +
    `║  🍔  *ITEM DETAILS — #${index}* ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `🍽️ *Name:* ${item.name}\n` +
    `💵 *Price:* ${formatLKR(item.price)}\n` +
    `📂 *Category:* ${item.category.toUpperCase()}\n` +
    `⚡ *Status:* ${statusEmoji}\n\n` +
    `📝 *Description:*\n_${item.description}_\n\n` +
    `⚠️ *Allergens:* ${item.allergens}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Reply *3* to go back to Menu_ ↩️\n` +
    `_Reply *0* to return to Main Menu_ 🔄`
  );
}

// ─────────────────────────────────────────────
// 6. AI REPLY FORMATTER
// ─────────────────────────────────────────────
function formatAIReply(rawText) {
  // Convert markdown bold (**text**) → WhatsApp bold (*text*)
  let text = rawText
    .replace(/\*\*(.+?)\*\*/g, "*$1*")        // **bold** → *bold*
    .replace(/#{1,3}\s?(.+)/g, "*$1*")         // ### Heading → *Heading*
    .replace(/^\s*[\-\*\+]\s+/gm, "▸ ")       // - bullet → ▸
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")       // keep numbered lists
    .trim();

  return (
    `╔═══════════════════════════════╗\n` +
    `║  🤖  *FOODIE HUB AI*  🤖  ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `${text}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_🕐 ${getTimestamp()}_`
  );
}

// ─────────────────────────────────────────────
// 7. MAIN MESSAGE HANDLER WITH VOICE CORE (STEP 1 & 2)
// ─────────────────────────────────────────────
const ADMIN_NUMBER = "94762057685@c.us";

client.on("message_create", async (msg) => {
  console.log(`📩 Message received from: ${msg.from} | body: "${msg.body}" | type: ${msg.type}`);
  if (msg.from !== ADMIN_NUMBER) return;

  let textToProcess = (msg.body || "").trim();
  let isVoice = false;

  // 🎙️ STEP 1 & 2: VOICE NOTE DETECTOR
  if (msg.hasMedia && (msg.type === "audio" || msg.type === "voice" || msg.type === "ptt")) {
    await msg.reply("📥 _Voice note received! Processing audio with AI..._");
    isVoice = true;

    try {
      console.time("📥 Download Media");
      const media = await msg.downloadMedia();
      console.timeEnd("📥 Download Media");

      if (media) {
        const fs = require("fs");
        const path = require("path");
        const filePath = path.join(__dirname, "voice.ogg");
        fs.writeFileSync(filePath, media.data, { encoding: "base64" });
        console.log("✅ Audio file saved locally.");

        console.log("🎙️ Sending audio to Groq Whisper API...");
        console.time("🎙️ Groq Transcription");
        const transcription = await groq.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: "whisper-large-v3",
          response_format: "json",
          language: "en",
        });
        console.timeEnd("🎙️ Groq Transcription");

        textToProcess = (transcription.text || "").trim();
        console.log(`🎙️ Transcribed Voice: "${textToProcess}"`);
        await msg.reply(`🗣️ *You said:* "${textToProcess}"`);
      }
    } catch (error) {
      console.error("❌ Speech-to-Text Error:", error);
      return msg.reply(`❌ _Error processing voice note:_ ${error.message}`);
    }
  }

  // 🧠 STEP 3: GEMINI INTENT & ANSWER PROCESSING
  // Normalize text to check if it's a simple digit command (e.g. remove punctuation)
  const cleanText = textToProcess.replace(/[.*]/g, "").trim().toLowerCase();
  const isNumberCommand = /^[0-4]$/.test(cleanText) || /^show\s+\d+$/i.test(cleanText);

  if (isVoice ? !isNumberCommand : !isNumberCommand) {
    // If it's a menu call, skip AI to keep it fast
    if (["hi", "hello", "menu", "start", "hey"].includes(cleanText)) {
      return msg.reply("╔═══════════════════════════════╗\n║  🍔  *FOODIE HUB ADMIN BOT* 🍔  ║\n╚═══════════════════════════════╝\n\nReply with numbers:\n1. Full Summary\n2. Recent Orders\n3. Menu Items\n\nOr just *ask me anything* via text or voice! 🎙️");
    }

    console.log("🧠 Querying Gemini AI for answers...");

    // Fetch fresh database context
    const dbContext = await getDatabaseContextForAI();
    if (dbContext.error) {
      return msg.reply(`❌ _Firebase Error:_ ${dbContext.error}`);
    }

    const systemPrompt = `You are the executive AI assistant for Foodie Hub restaurant management system. 
    Here is the live real-time database summary right now:
    - Total Users registered: ${dbContext.totalUsers}
    - Total Income/Revenue (All-Time): ${dbContext.totalIncome}
    - Total Orders placed (All-Time): ${dbContext.totalOrders}
    - Completed Orders (All-Time): ${dbContext.completedOrders}
    - Pending/Processing Orders (All-Time): ${dbContext.pendingOrders}
    - Cancelled Orders (All-Time): ${dbContext.cancelledOrders}
    - Most Popular/Selling Item today: ${dbContext.popularItem}
    - Menu Items List: [${dbContext.menuItemsList}]

    TODAY'S METRICS (Sri Lanka timezone: Asia/Colombo, Date: ${new Date().toLocaleDateString("en-US", { timeZone: "Asia/Colombo" })}):
    - Today's Total Orders: ${dbContext.todayOrdersCount}
    - Today's Completed Orders: ${dbContext.todayCompletedOrders}
    - Today's Pending/Processing Orders: ${dbContext.todayPendingOrders}
    - Today's Cancelled Orders: ${dbContext.todayCancelledOrders}
    - Today's Income/Revenue: ${dbContext.todayIncome}

    Answer the user's query professionally based ONLY on this data. When the user asks for "today's" stats (e.g., today's orders, today's income), refer STRICTLY to TODAY'S METRICS. If they are 0, state they are 0. Keep the answers concise and strictly accurate.`;

    try {
      let response;
      let retries = 3;
      let delay = 3000; // Start with 3 seconds delay

      for (let i = 0; i < retries; i++) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: textToProcess,
            config: {
              systemInstruction: systemPrompt
            }
          });
          break; // Success, exit loop
        } catch (err) {
          if (err.status === 429 && i < retries - 1) {
            console.warn(`⏳ Gemini rate limited (429). Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff (3s -> 6s)
          } else {
            throw err; // Re-throw if not 429 or out of retries
          }
        }
      }

      const aiReply = response.text;
      console.log(`🤖 Gemini Reply: "${aiReply}"`);

      // ──────────────────────────────────────────────────────────
      // 🗣️ TEXT-TO-SPEECH WITH ELEVENLABS (STEP 4)
      // ──────────────────────────────────────────────────────────
      // Detect if AI response is a list or long — needs text card too
      const hasMultiplePrices = (aiReply.match(/LKR/gi) || []).length >= 3;
      const hasListPattern = /\n\s*(\d+[\.\-\)]|[\-\*\+])\s+/.test(aiReply);
      const shouldAlsoSendText = aiReply.length > 400 || hasMultiplePrices || hasListPattern;

      const axios = require('axios');
      const fs = require('fs');
      const path = require('path');
      const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
      const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";

      if (isVoice) {
        // Build clean spoken text (strip markdown symbols for TTS clarity)
        const spokenText = aiReply.replace(/\*\*/g, "").replace(/\*/g, "").replace(/#+\s?/g, "").trim();

        await msg.reply("🎙️ _Generating voice response..._");
        try {
          console.time("🎙️ ElevenLabs TTS");
          const ttsResponse = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=opus_48000_128`,
            data: {
              text: spokenText,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.5, similarity_boost: 0.5 }
            },
            headers: {
              'accept': 'audio/ogg',
              'xi-api-key': ELEVENLABS_API_KEY,
              'content-type': 'application/json'
            },
            responseType: 'arraybuffer'
          });
          console.timeEnd("🎙️ ElevenLabs TTS");

          const outputAudioPath = path.join(__dirname, 'output.ogg');
          fs.writeFileSync(outputAudioPath, ttsResponse.data);
          console.log("✅ Voice response generated and saved as output.ogg");

          const outputMedia = MessageMedia.fromFilePath(outputAudioPath);
          console.log(`📤 Sending voice note | mime=${outputMedia.mimetype}`);

          // 1️⃣ Always send voice note
          await msg.reply(outputMedia, null, { sendAudioAsVoice: true });

          // 2️⃣ If reply is a long list, ALSO send formatted text card
          if (shouldAlsoSendText) {
            await msg.reply(formatAIReply(aiReply));
          }
          return;
        } catch (sendError) {
          console.error("❌ Failed to send voice note reply:", sendError);
          return msg.reply(formatAIReply(aiReply));
        }

      } else {
        // Pure text query → nicely formatted text card
        return msg.reply(formatAIReply(aiReply));
      }
      // ──────────────────────────────────────────────────────────

    } catch (aiError) {
      console.error("❌ Gemini/TTS Error:", aiError);
      return msg.reply(`❌ _AI Processing Error:_ ${aiError.message}`);
    }
  }

  // STANDARD DIGIT COMMAND HANDLERS (If user just types 1, 2, 3)
  const text = textToProcess.replace(/[.*]/g, "").trim();

  if (["hi", "hello", "hey", "menu", "0", "start"].includes(text.toLowerCase())) {
    return msg.reply(buildMainMenu());
  }

  if (text === "1") {
    await msg.reply("⏳ _Fetching live data from Firebase... Please wait._");
    const report = await getSystemSummary();
    if (report.success) return msg.reply(buildSummaryReport(report));
    return msg.reply(`❌ *Firebase Error:* _${report.error}_`);
  }

  if (text === "2") {
    await msg.reply("⏳ _Fetching recent orders from Firebase..._");
    const data = await getRecentOrders();
    if (data.success) return msg.reply(buildRecentOrders(data));
    return msg.reply(`❌ *Firebase Error:* _${data.error}_`);
  }

  if (text === "3") {
    await msg.reply("⏳ _Fetching menu items from Firebase..._");
    const data = await getMenuItems();
    if (data.success) return msg.reply(buildMenuItemsList(data));
    return msg.reply(`❌ *Firebase Error:* _${data.error}_`);
  }

  if (/^show\s+\d+$/i.test(text)) {
    const numStr = text.split(/\s+/)[1];
    const index = parseInt(numStr, 10);
    if (isNaN(index) || index <= 0) return await msg.reply("⚠️ *Invalid item number!*");

    await msg.reply("⏳ _Fetching item details..._");
    const data = await getMenuItems();
    if (!data.success) return await msg.reply(`❌ *Error fetching data:* ${data.error}`);
    if (index > data.items.length) return await msg.reply(`⚠️ *Item #${index} not found!*`);

    const item = data.items[index - 1];
    const details = buildItemDetails(item, index);

    if (item.imageUrl) {
      try {
        const media = await MessageMedia.fromUrl(item.imageUrl);
        return await msg.reply(media, null, { caption: details });
      } catch (mediaError) {
        console.error("⚠️ Media send failed:", mediaError);
        return await msg.reply(`⚠️ _Could not load image, sending details only:_\n\n` + details);
      }
    } else {
      return await msg.reply(details);
    }
  }

  await msg.reply(`🤔 *Unknown command:* _"${text}"_\n\nReply *menu* or *0* to see options.`);
});

// Prevent bot crash on unhandled async rejections
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

// Graceful shutdown on Ctrl+C (SIGINT)
process.on("SIGINT", async () => {
  console.log("\n🛑 (SIGINT) Gracefully shutting down Foodie Hub Bot...");
  try {
    await client.destroy();
    console.log("✅ Client destroyed successfully. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
    process.exit(1);
  }
});

// ─────────────────────────────────────────────
// 7. LAUNCH BOT
// ─────────────────────────────────────────────
console.log("🚀 Initializing WhatsApp Client (launching Puppeteer)...");

client.initialize().catch((err) => {
  console.error("❌ Client initialization failed:", err);
});