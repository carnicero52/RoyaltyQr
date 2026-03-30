import express from "express";
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  query, 
  where, 
  updateDoc, 
  serverTimestamp, 
  writeBatch,
  Firestore,
  Timestamp
} from "firebase/firestore";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import cors from "cors";
import { formatInTimeZone } from "date-fns-tz";

console.log("[Server] Initializing server.ts module...");
console.log("[Server] process.cwd():", process.cwd());
console.log("[Server] __dirname:", typeof __dirname !== 'undefined' ? __dirname : 'undefined');

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper to get Firebase config
function getFirebaseConfig() {
  // Load local config as base
  let localConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      localConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log("[Firebase/Config] Loaded local config from:", configPath);
    }
  } catch (err) {
    console.error("[Firebase/Config] Error reading local config:", err);
  }

  // Override with environment variables
  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || localConfig.apiKey,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || localConfig.projectId,
    appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || localConfig.appId,
    firestoreDatabaseId: process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID || localConfig.firestoreDatabaseId
  };

  console.log("[Firebase/Config] Config resolved. Project ID:", config.projectId);
  console.log("[Firebase/Config] Database ID:", config.firestoreDatabaseId || "(default)");

  return config.projectId ? config : null;
}

// Initialize Firebase Client SDK
let db: Firestore | null = null;

async function getDb() {
  if (db) return db;

  const config = getFirebaseConfig();
  if (!config || !config.apiKey) {
    console.error("[Firebase/Client] Firebase config not found or incomplete!", config);
    return null;
  }

  try {
    console.log("[Firebase/Client] Initializing Client SDK with project:", config.projectId);
    
    let clientApp: FirebaseApp;
    const apps = getApps() || [];
    if (apps.length === 0) {
      clientApp = initializeApp(config);
    } else {
      clientApp = getApp();
    }
    
    const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" && config.firestoreDatabaseId !== ""
      ? config.firestoreDatabaseId 
      : undefined;
    
    console.log("[Firebase/Client] Using database ID:", dbId || "(default)");
    db = dbId ? getFirestore(clientApp, dbId) : getFirestore(clientApp);
    console.log("[Firebase/Client] Client SDK SUCCESS: Connection verified.");
    return db;
  } catch (error) {
    console.error("[Firebase/Client] Error initializing Client SDK:", error);
    return null;
  }
}

// Notification services
const processingReminders = new Set<string>();

async function sendNotification(type: string, to: string, message: string, config: any, subject?: string) {
  console.log(`[Notification] Sending ${type} to ${to}...`);
  
  if (type === "email") {
    const user = config?.gmailUser || process.env.GMAIL_USER;
    const pass = config?.gmailAppPass || process.env.GMAIL_APP_PASS;

    if (!user || !pass) {
      throw new Error("Gmail credentials not configured.");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: user,
      to,
      subject: subject || "Notificación de Negocio",
      text: message,
    });
  } else if (type === "telegram") {
    const token = config?.telegramToken || process.env.TELEGRAM_TOKEN;
    const chatId = to || config?.telegramChatId || process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      throw new Error("Telegram credentials (token/chatId) not configured.");
    }

    const bot = new TelegramBot(token);
    await bot.sendMessage(chatId, message);
  } else if (type === "whatsapp") {
    let phone = to.replace(/\D/g, ""); // Remove all non-digits
    // Ensure country code (default to 58 for Venezuela if it starts with 0 or is 10 digits)
    if (phone.startsWith("0")) phone = "58" + phone.substring(1);
    if (phone.length === 10) phone = "58" + phone;
    
    const apiKey = config?.whatsappApiKey || process.env.WHATSAPP_API_KEY;

    if (!phone || !apiKey) {
      throw new Error("WhatsApp credentials (phone/apiKey) not configured.");
    }

    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    console.log(`[WhatsApp] Calling URL: ${url.replace(apiKey, 'HIDDEN')}`);
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CallMeBot error: ${errorText}`);
    }
  }
}

// Send summary to owner
async function sendSummary() {
  console.log("[Cron] Checking daily summary...");
  const firestore = await getDb();
  if (!firestore) return;

  try {
    const businessesSnap = await getDocs(collection(firestore, "businesses"));
    
    for (const bDoc of businessesSnap.docs) {
      const business = bDoc.data();
      if (!business.notifySummary) continue;

      const tz = business.timezone || "America/Caracas";
      const nowInTz = formatInTimeZone(new Date(), tz, "HH:mm");
      const hour = parseInt(nowInTz.split(":")[0]);
      const minute = parseInt(nowInTz.split(":")[1]);

      // Send summary between 8:00 PM and 8:15 PM
      // We use a range because the interval is 10 minutes
      if (hour === 20 && minute < 15) {
        // Check if already sent today to avoid duplicates within the 15min window
        const lastSummaryKey = `last_summary_${bDoc.id}_${formatInTimeZone(new Date(), tz, "yyyy-MM-dd")}`;
        if ((global as any)[lastSummaryKey]) continue;

        console.log(`[Cron] Sending summary for ${business.name}`);
        (global as any)[lastSummaryKey] = true;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString();
        
        const q = query(
          collection(firestore, "businesses", bDoc.id, "purchases"),
          where("timestamp", ">=", todayIso)
        );
        const purchasesSnap = await getDocs(q);

        const count = purchasesSnap.size;
        const msg = `📊 Resumen Diario - ${business.name}\n\nTotal de compras hoy: ${count}\n¡Buen trabajo!`;
        
        if (business.notifyTelegram && business.telegramChatId) {
          await sendNotification("telegram", business.telegramChatId, msg, business);
        }
        if (business.notifyEmail && business.ownerEmail) {
          await sendNotification("email", business.ownerEmail, msg, business, "Resumen Diario");
        }
      }
    }
  } catch (error) {
    console.error("[Cron] Error in sendSummary:", error);
  }
}

// Check reminders
async function checkReminders() {
  console.log("[Cron] Checking reminders...");
  const firestore = await getDb();
  if (!firestore) return;

  try {
    const now = new Date();
    
    // Get pending reminders
    const q = query(collection(firestore, "reminders"), where("status", "==", "pending"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("[Cron] No pending reminders.");
      return;
    }

    for (const docSnap of snapshot.docs) {
      const reminderId = docSnap.id;
      if (processingReminders.has(reminderId)) continue;
      
      const reminder = docSnap.data();
      let scheduledTime: Date;

      try {
        if (typeof reminder.scheduledAt === "string") {
          scheduledTime = new Date(reminder.scheduledAt);
        } else if (reminder.scheduledAt instanceof Timestamp) {
          scheduledTime = reminder.scheduledAt.toDate();
        } else if (reminder.scheduledAt?.toDate) {
          scheduledTime = reminder.scheduledAt.toDate();
        } else if (reminder.scheduledAt?.seconds) {
          scheduledTime = new Date(reminder.scheduledAt.seconds * 1000);
        } else {
          scheduledTime = new Date(reminder.scheduledAt);
        }
      } catch (e) {
        console.error(`[Cron] Invalid date for reminder ${reminderId}:`, reminder.scheduledAt);
        continue;
      }

      if (scheduledTime <= now) {
        processingReminders.add(reminderId);
        console.log(`[Cron] Processing reminder: ${reminderId}`);

        try {
          // Fetch business config
          const businessSnap = await getDoc(doc(firestore, "businesses", reminder.businessId));
          const business = businessSnap.data();

          if (!business) {
            throw new Error(`Business ${reminder.businessId} not found.`);
          }

          // Fetch customer data
          const customerSnap = await getDoc(doc(firestore, "businesses", reminder.businessId, "customers", reminder.customerId));
          const customer = customerSnap.data();

          if (!customer) {
            throw new Error(`Customer ${reminder.customerId} not found.`);
          }

          // Determine notification methods
          const methods = [];
          if (business.notifyEmail && (customer.email || business.ownerEmail)) methods.push("email");
          if (business.notifyTelegram && business.telegramChatId) methods.push("telegram");
          if (business.notifyWhatsapp && (customer.phone || business.whatsappPhone)) methods.push("whatsapp");

          const results = [];
          for (const method of methods) {
            try {
              const to = method === "email" ? (customer.email || business.ownerEmail) : 
                         method === "telegram" ? business.telegramChatId : 
                         (customer.phone || business.whatsappPhone);
              
              await sendNotification(method, to, reminder.message, business, reminder.subject);
              results.push({ method, status: "success" });
            } catch (err: any) {
              console.error(`[Cron] Error sending ${method}:`, err.message);
              results.push({ method, status: "error", error: err.message });
            }
          }

          // Update reminder status
          const finalStatus = results.some(r => r.status === "success") ? "sent" : "failed";
          await updateDoc(docSnap.ref, {
            status: finalStatus,
            sentAt: serverTimestamp(),
            results
          });

          // Notify admin if it failed
          if (finalStatus === "failed") {
            try {
              await sendNotification("telegram", business.telegramChatId, `⚠️ Error al enviar recordatorio a ${customer.name}: ${results.map(r => r.error).join(", ")}`, business);
            } catch (e) {}
          }

        } catch (err: any) {
          console.error(`[Cron] Fatal error processing reminder ${reminderId}:`, err);
          await updateDoc(docSnap.ref, {
            status: "error",
            error: err.message
          });
        } finally {
          processingReminders.delete(reminderId);
        }
      }
    }
  } catch (error) {
    console.error("[Cron] Error in checkReminders:", error);
  }
}

// API Routes
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    env: {
      hasApiKey: !!(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY),
      hasProjectId: !!(process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID),
      hasDbId: !!(process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID),
      nodeEnv: process.env.NODE_ENV,
      isVercel: !!process.env.VERCEL
    }
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", sdk: "client" });
});

app.get("/api/test-db", async (req, res) => {
  try {
    console.log("[API/TestDB] Initializing DB...");
    const firestore = await getDb();
    if (!firestore) {
      console.error("[API/TestDB] DB initialization failed");
      return res.status(500).json({ 
        error: "DB not initialized", 
        details: "Check server logs for initialization errors"
      });
    }

    const dbInfo = {
      projectId: getApp().options.projectId,
      databaseId: (firestore as any).databaseId || "(default)"
    };
    
    console.log("[API/TestDB] Fetching businesses...");
    const snapshot = await getDocs(collection(firestore, "businesses"));
    console.log("[API/TestDB] Found businesses:", snapshot.size);
    
    res.json({ 
      success: true,
      status: "ok", 
      db: dbInfo,
      count: snapshot.size,
      businesses: snapshot.docs.map(d => ({ id: d.id, name: d.data().name }))
    });
  } catch (error: any) {
    console.error("[API/TestDB] Error:", error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post("/api/notify", async (req, res) => {
  const { type, data, config, message, subject, toEmail, toPhone } = req.body;
  console.log(`[API/Notify] Received request for type: ${type}`);

  let msg = message;
  if (!msg && data) {
    if (type === "Compra Registrada") {
      msg = `🔔 ¡Nueva Compra!\n\nCliente: ${data.customer}\nSellos: ${data.coupons}\nNegocio: ${data.business}`;
    } else if (type === "Premio Alcanzado") {
      msg = `🎉 ¡PREMIO ALCANZADO!\n\nEl cliente ${data.customer} ha completado sus sellos (${data.coupons}) en ${data.business}.`;
    } else {
      msg = `${type}: ${JSON.stringify(data)}`;
    }
  }
  if (!msg) msg = "Notificación del sistema";

  const results: any = {};
  const methods: ("email" | "telegram" | "whatsapp")[] = [];
  
  // Determine which channels to use
  if (toEmail || (config?.email && !data)) methods.push("email");
  if (config?.telegramChatId) methods.push("telegram");
  if (toPhone || config?.whatsappPhone) methods.push("whatsapp");

  for (const method of methods) {
    try {
      const to = method === "email" ? (toEmail || config.email) : 
                 method === "telegram" ? config.telegramChatId : 
                 (toPhone || config.whatsappPhone);
      
      if (!to) continue;
      
      await sendNotification(method, to, msg, config, subject);
      results[method] = { success: true };
    } catch (err: any) {
      console.error(`[API/Notify] Error sending ${method}:`, err);
      results[method] = { success: false, error: err.message };
    }
  }

  res.json({ success: true, results });
});

app.post("/api/process-reminders", async (req, res) => {
  try {
    await checkReminders();
    res.json({ success: true, message: "Recordatorios procesados." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/cron", async (req, res) => {
  console.log("[Cron] Manual trigger received");
  try {
    await checkReminders();
    await sendSummary();
    res.json({ success: true, message: "Cron tasks executed." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/clear-history/:type", async (req, res) => {
  const { type } = req.params;
  const { businessId } = req.body;

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }

  try {
    const firestore = await getDb();
    if (!firestore) return res.status(500).json({ error: "DB not initialized" });

    let deletedCount = 0;

    // Clear reminders of specific type for this business
    const qReminders = query(collection(firestore, "reminders"), where("businessId", "==", businessId));
    const snapshot = await getDocs(qReminders);
    
    const batch = writeBatch(firestore);
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === type || (type === "billing" && !data.type)) {
        batch.delete(docSnap.ref);
        deletedCount++;
      }
    });

    // If billing, also clear purchases
    if (type === "billing") {
      const purchasesSnap = await getDocs(collection(firestore, "businesses", businessId, "purchases"));
      purchasesSnap.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
        deletedCount++;
      });
    }

    await batch.commit();

    res.json({ 
      success: true, 
      message: `Historial de ${type} limpiado con éxito.`,
      deleted: deletedCount 
    });
  } catch (error: any) {
    console.error(`Error clearing ${type} history:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
    path: req.path
  });
});

// Start Cron Jobs
console.log("[Cron] Starting background tasks...");

// Run reminder check every minute
setInterval(() => {
  console.log("[Cron/Interval] Triggering checkReminders...");
  checkReminders().catch(err => console.error("[Cron/Interval] Error in checkReminders:", err));
}, 60000);

// Run summary check every 10 minutes
setInterval(() => {
  console.log("[Cron/Interval] Triggering sendSummary...");
  sendSummary().catch(err => console.error("[Cron/Interval] Error in sendSummary:", err));
}, 600000);

// Run immediately on start
setTimeout(() => {
  console.log("[Cron/Startup] Running initial checks...");
  checkReminders();
  sendSummary();
}, 5000);

export default app;

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}
