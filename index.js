const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ─────────────────────────────────────────────
// 1. FIREBASE INITIALIZATION
// ─────────────────────────────────────────────
const serviceAccount = require("./firebase-key.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

// ─────────────────────────────────────────────
// 2. WHATSAPP CLIENT INITIALIZATION
// ─────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
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

client.on("auth_failure", () => {
  console.error("❌ Authentication failed! Please delete .wwebjs_auth folder and restart.");
});

client.on("disconnected", (reason) => {
  console.warn("⚠️  Bot disconnected:", reason);
});

// ─────────────────────────────────────────────
// 3. HELPER UTILITIES
// ─────────────────────────────────────────────

// Returns greeting based on current Sri Lanka time
function getGreeting() {
  const hour = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
  ).getHours();

  if (hour >= 5 && hour < 12) return "🌅 Good Morning";
  if (hour >= 12 && hour < 17) return "☀️ Good Afternoon";
  if (hour >= 17 && hour < 21) return "🌇 Good Evening";
  return "🌙 Good Night";
}

// Returns current date & time formatted
function getTimestamp() {
  return new Date().toLocaleString("en-LK", {
    timeZone: "Asia/Colombo",
    dateStyle: "full",
    timeStyle: "short",
  });
}

// Format LKR currency
function formatLKR(amount) {
  return `LKR ${Number(amount).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─────────────────────────────────────────────
// 4. FIREBASE DATA FETCHERS
// ─────────────────────────────────────────────

// Full system summary
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

    const activeMenuItems = menuSnapshot.docs.filter(
      (doc) => doc.data().available !== false
    ).length;

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

// Recent orders (last 5)
async function getRecentOrders() {
  try {
    const snapshot = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

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

// Menu items
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

    // Sort items by category and then by name
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

// ─────────────────────────────────────────────
// 5. MESSAGE BUILDERS
// ─────────────────────────────────────────────

function buildMainMenu() {
  return (
    `╔═══════════════════════════════╗\n` +
    `║  🍔  *FOODIE HUB ADMIN BOT*  🍔  ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `${getGreeting()}, Admin! 👋\n` +
    `_${getTimestamp()}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *AVAILABLE COMMANDS:*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*1️⃣  → Full System Summary*\n` +
    `   📊 Users, Menu, Orders & Income\n\n` +
    `*2️⃣  → Recent Orders*\n` +
    `   🧾 Last 5 orders placed\n\n` +
    `*3️⃣  → View Menu Items*\n` +
    `   🍔 List of food items by category\n\n` +
    `*0️⃣  → Show This Menu Again*\n` +
    `   🔄 Display all commands\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Reply with a number to continue_ 👆`
  );
}

function buildSummaryReport(report) {
  const completionRate =
    report.totalOrders > 0
      ? ((report.completedOrders / report.totalOrders) * 100).toFixed(1)
      : 0;

  return (
    `╔═══════════════════════════════╗\n` +
    `║  📊  *FOODIE HUB — SYSTEM REPORT*  ║\n` +
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
  if (!data.orders || data.orders.length === 0) {
    return "📭 *No recent orders found.*\n\n_Reply *0* to return to menu_ 🔄";
  }

  const statusEmoji = {
    completed: "✅",
    pending: "⏳",
    processing: "🔄",
    cancelled: "❌",
  };

  let msg =
    `╔═══════════════════════════════╗\n` +
    `║  🧾  *RECENT ORDERS (Last 5)*  ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `🕐 _${getTimestamp()}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  data.orders.forEach((order, i) => {
    const emoji = statusEmoji[order.status.toLowerCase()] || "📋";
    msg +=
      `\n*Order ${i + 1} — #${order.id}*\n` +
      `${emoji} Status:  *${order.status.toUpperCase()}*\n` +
      `🛍️  Items:    *${order.items}*\n` +
      `💵 Total:    *${formatLKR(order.total)}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━`;
  });

  msg += "\n\n_Reply *0* to return to menu_ 🔄";
  return msg;
}

function buildMenuItemsList(data) {
  if (!data.items || data.items.length === 0) {
    return "📭 *No menu items found.*\n\n_Reply *0* to return to menu_ 🔄";
  }

  let msg =
    `╔═══════════════════════════════╗\n` +
    `║  🍔  *FOODIE HUB — MENU ITEMS*  ║\n` +
    `╚═══════════════════════════════╝\n\n` +
    `🕐 _${getTimestamp()}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  let currentCategory = "";
  data.items.forEach((item, index) => {
    const cat = (item.category || "Other").toUpperCase();
    if (cat !== currentCategory) {
      if (currentCategory !== "") {
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      }
      msg += `\n*📂 ${cat}*\n`;
      currentCategory = cat;
    }
    const statusEmoji = item.available ? "✅" : "❌";
    msg += `*${index + 1}.* ${item.name} — *${formatLKR(item.price)}* ${statusEmoji}\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `👉 Reply with *show <number>* (e.g., *show 1*) to view picture & details.\n\n`;
  msg += `_Reply *0* to return to menu_ 🔄`;
  return msg;
}

function buildItemDetails(item, index) {
  const statusEmoji = item.available ? "✅ Available" : "❌ Unavailable";
  return (
    `╔═══════════════════════════════╗\n` +
    `║  🍔  *ITEM DETAILS — #${index}*  ║\n` +
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
// 6. MAIN MESSAGE HANDLER
// ─────────────────────────────────────────────

const ADMIN_NUMBER = "94762057685@c.us";

client.on("message_create", async (msg) => {
  // Only respond to admin
  if (msg.from !== ADMIN_NUMBER) return;

  const text = msg.body.trim();

  // Greet / Show Menu
  if (["hi", "hello", "hey", "menu", "0", "start"].includes(text.toLowerCase())) {
    return msg.reply(buildMainMenu());
  }

  // Option 1 — Full System Summary
  if (text === "1") {
    await msg.reply("⏳ _Fetching live data from Firebase... Please wait._");
    const report = await getSystemSummary();

    if (report.success) {
      return msg.reply(buildSummaryReport(report));
    } else {
      return msg.reply(
        `❌ *Firebase Error!*\n\n` +
        `Something went wrong while fetching data.\n\n` +
        `🛠️ Error: _${report.error}_\n\n` +
        `_Please check your Firebase connection._`
      );
    }
  }

  // Option 2 — Recent Orders
  if (text === "2") {
    await msg.reply("⏳ _Fetching recent orders from Firebase..._");
    const data = await getRecentOrders();

    if (data.success) {
      return msg.reply(buildRecentOrders(data));
    } else {
      return msg.reply(
        `❌ *Firebase Error!*\n\n` +
        `_${data.error}_\n\n` +
        `_Reply *0* to return to menu_ 🔄`
      );
    }
  }

  // Option 3 — View Menu Items
  if (text === "3") {
    await msg.reply("⏳ _Fetching menu items from Firebase..._");
    const data = await getMenuItems();

    if (data.success) {
      return msg.reply(buildMenuItemsList(data));
    } else {
      return msg.reply(
        `❌ *Firebase Error!*\n\n` +
        `_${data.error}_\n\n` +
        `_Reply *0* to return to menu_ 🔄`
      );
    }
  }

  // Option: show <number> — Show individual item details with image
  if (text.toLowerCase().startsWith("show ")) {
    const numStr = text.slice(5).trim();
    const index = parseInt(numStr, 10);

    if (isNaN(index) || index <= 0) {
      return msg.reply("⚠️ *Invalid item number!* Please reply with a valid number (e.g., *show 1*).");
    }

    await msg.reply("⏳ _Fetching item details..._");
    const data = await getMenuItems();

    if (!data.success) {
      return msg.reply(`❌ *Error fetching data:* ${data.error}`);
    }

    if (index > data.items.length) {
      return msg.reply(`⚠️ *Item #${index} not found!* Total items available: *${data.items.length}*.`);
    }

    const item = data.items[index - 1];
    const details = buildItemDetails(item, index);

    if (item.imageUrl) {
      try {
        const media = await MessageMedia.fromUrl(item.imageUrl);
        return client.sendMessage(msg.from, media, { caption: details });
      } catch (mediaError) {
        console.error("❌ Error loading image from URL:", mediaError);
        return msg.reply(
          `⚠️ _Could not load image, sending details only:_\n\n` + details
        );
      }
    } else {
      return msg.reply(details);
    }
  }

  // Unknown command
  msg.reply(
    `🤔 *Unknown command:* _"${text}"_\n\n` +
    `Reply *menu* or *0* to see all available options. 👆`
  );
});

// ─────────────────────────────────────────────
// 7. LAUNCH BOT
// ─────────────────────────────────────────────
console.log("🚀 Initializing WhatsApp Client (launching Puppeteer)...");

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Loading: ${percent}% - ${message}`);
});

client.on("authenticated", () => {
  console.log("🔑 Authenticated successfully!");
});

client.initialize().catch((err) => {
  console.error("❌ Client initialization failed:", err);
});

