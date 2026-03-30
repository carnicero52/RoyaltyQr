import express from "express";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, query, where, deleteDoc } from "firebase/firestore";
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

  console.log("[Firebase/Config] Config resolved. API Key present:", !!config.apiKey);
  console.log("[Firebase/Config] Project ID:", config.projectId);
  console.log("[Firebase/Config] Database ID:", config.firestoreDatabaseId || "(default)");

  return config.apiKey ? config : null;
}

// Initialize Firebase Client SDK
let db: any = null;

async function getDb() {
  if (db) return db;

  const config = getFirebaseConfig();
  if (!config || !config.apiKey) {
    console.error("[Firebase/Server] Firebase config not found or incomplete!", config);
    return null;
  }

  try {
    console.log("[Firebase/Server] Initializing Firebase with project:", config.projectId);
    const firebaseApp = initializeApp(config);
    // Use the database ID if provided, otherwise default
    const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" && config.firestoreDatabaseId !== ""
      ? config.firestoreDatabaseId 
      : undefined;
    
    console.log("[Firebase/Server] Using database ID:", dbId || "(default)");
    db = dbId ? getFirestore(firebaseApp, dbId) : getFirestore(firebaseApp);
    console.log("[Firebase/Server] Client SDK SUCCESS: Connection verified.");
    return db;
  } catch (error) {
    console.error("[Firebase/Server] Error initializing Client SDK:", error);
    return null;
  }
}

// Notification services
async function sendNotification(type: "email" | "telegram" | "whatsapp", to: string, message: string, config?: any, subject?: string) {
  console.log(`[Notification] Sending ${type} to ${to}`);
  
  if (type === "email") {
    const user = config?.gmailUser || process.env.EMAIL_USER;
    const pass = config?.gmailAppPass || process.env.EMAIL_PASS;
    
    if (!user || !pass) {
      throw new Error("Email credentials (gmailUser/gmailAppPass) not configured.");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: user,
      to,
      subject: subject || "Recordatorio",
      text: message,
    });
  } else if (type === "telegram") {
    const token = config?.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = to || config?.telegramChatId;

    if (!token || !chatId) {
      throw new Error("Telegram credentials (token/chatId) not configured.");
    }

    const bot = new TelegramBot(token, { polling: false });
    await bot.sendMessage(chatId, message);
  } else if (type === "whatsapp") {
    const phone = to.replace(/\+/g, "");
    const apiKey = config?.whatsappApiKey || process.env.WHATSAPP_API_KEY;

    if (!phone || !apiKey) {
      throw new Error("WhatsApp credentials (phone/apiKey) not configured.");
    }

    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CallMeBot error: ${errorText}`);
    }
  }
}

// Send summary to owner
async function sendSummary() {
  const firestore = await getDb();
  if (!firestore) return;

  const businessesRef = collection(firestore, "businesses");
  const businessesSnap = await getDocs(businessesRef);

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  for (const busDoc of businessesSnap.docs) {
    const business = busDoc.data();
    const businessId = busDoc.id;

    if (!business.notificationsEnabled) continue;

    const purchasesRef = collection(firestore, "businesses", businessId, "purchases");
    const q = query(purchasesRef, where("timestamp", ">=", oneHourAgo));
    const purchasesSnap = await getDocs(q);

    if (!purchasesSnap.empty) {
      const count = purchasesSnap.size;
      const totalAmount = purchasesSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
      const summaryMsg = `📊 Resumen de la última hora en ${business.name}:\n\n- Ventas registradas: ${count}\n- Monto total: ${business.currency || "$"}${totalAmount.toLocaleString()}`;

      const config = {
        gmailUser: business.gmailUser,
        gmailAppPass: business.gmailAppPass,
        telegramToken: business.telegramToken,
        telegramChatId: business.telegramChatId,
        whatsappApiKey: business.whatsappApiKey,
      };

      if (business.ownerEmail) {
        try { await sendNotification("email", business.ownerEmail, summaryMsg, config, `Resumen ${business.name}`); } catch (e) {}
      }
      if (business.telegramChatId) {
        try { await sendNotification("telegram", business.telegramChatId, summaryMsg, config); } catch (e) {}
      }
      if (business.whatsappPhone && business.whatsappApiKey) {
        try { await sendNotification("whatsapp", business.whatsappPhone, summaryMsg, config); } catch (e) {}
      }
    }
  }
}

// Check reminders
async function checkReminders() {
  const firestore = await getDb();
  if (!firestore) return;

  const now = new Date().toISOString();
  const remindersRef = collection(firestore, "reminders");
  const q = query(remindersRef, where("scheduledAt", "<=", now), where("status", "==", "pending"));

  const querySnapshot = await getDocs(q);
  console.log(`[Reminders] Found ${querySnapshot.size} pending reminders to process.`);

  for (const docSnap of querySnapshot.docs) {
    const reminder = docSnap.data();
    const businessId = reminder.businessId;
    
    try {
      const businessDoc = await getDocs(query(collection(firestore, "businesses"), where("__name__", "==", businessId)));
      
      if (!businessDoc.empty) {
        const business = businessDoc.docs[0].data();
        const config = {
          gmailUser: business.gmailUser,
          gmailAppPass: business.gmailAppPass,
          telegramToken: business.telegramToken,
          whatsappApiKey: business.whatsappApiKey,
        };
        
        console.log(`[Reminders] Processing reminder for business: ${business.name}`);

        // Notify business owner about the action (optional)
        if (business.ownerEmail) {
          try { await sendNotification("email", business.ownerEmail, `[NOTIFICACIÓN DUEÑO] Se está procesando un recordatorio: ${reminder.message}`, config); } catch (e) {}
        }
        
        // Notify target customers
        const targetCustomerIds = reminder.customerIds || (reminder.customerId ? [reminder.customerId] : []);
        let anySuccess = false;
        let errors: string[] = [];

        for (const custId of targetCustomerIds) {
          const custSnap = await getDocs(query(collection(firestore, "businesses", businessId, "customers"), where("__name__", "==", custId)));
          if (!custSnap.empty) {
            const cust = custSnap.docs[0].data();
            
            // Personal Email
            if (cust.email) {
              try {
                await sendNotification("email", cust.email, reminder.message, config, reminder.subject);
                anySuccess = true;
              } catch (err: any) {
                errors.push(`Email to ${cust.email} failed: ${err.message}`);
              }
            }
            
            // Personal Telegram
            if (cust.telegramChatId) {
              try {
                await sendNotification("telegram", cust.telegramChatId, reminder.message, config);
                anySuccess = true;
              } catch (err: any) {
                errors.push(`Telegram to ${cust.telegramChatId} failed: ${err.message}`);
              }
            }
            
            // Personal WhatsApp (CallMeBot)
            if (cust.phone && (cust.callmebotApiKey || business.whatsappApiKey)) {
              try {
                const personalConfig = { ...config, whatsappApiKey: cust.callmebotApiKey || business.whatsappApiKey };
                await sendNotification("whatsapp", cust.phone, reminder.message, personalConfig);
                anySuccess = true;
              } catch (err: any) {
                errors.push(`WhatsApp to ${cust.phone} failed: ${err.message}`);
              }
            }
          }
        }
        
        await setDoc(doc(firestore, "reminders", docSnap.id), { 
          ...reminder, 
          status: anySuccess ? "sent" : "failed",
          statusMessage: errors.length > 0 ? errors.join(", ") : undefined
        }, { merge: true });
      } else {
        console.warn(`[Reminders] Business ${businessId} not found for reminder ${docSnap.id}`);
        await setDoc(doc(firestore, "reminders", docSnap.id), { ...reminder, status: "failed", statusMessage: "Business not found" }, { merge: true });
      }
    } catch (err: any) {
      console.error(`[Reminders] Error processing reminder ${docSnap.id}:`, err);
    }
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
        details: "Check server logs for initialization errors",
        hasEnv: !!(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY)
      });
    }

    const dbInfo = {
      projectId: firestore.app.options.projectId,
      databaseId: (firestore as any)._databaseId?.database || "(default)"
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
  if (toEmail || config?.email) methods.push("email");
  if (config?.telegramChatId) methods.push("telegram");
  if (toPhone || config?.whatsappPhone) methods.push("whatsapp");

  for (const method of methods) {
    try {
      const to = method === "email" ? (toEmail || config.email) : 
                 method === "telegram" ? config.telegramChatId : 
                 (toPhone || config.whatsappPhone);
      await sendNotification(method, to, msg, config, subject);
      results[method] = { success: true };
    } catch (err: any) {
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
    const remindersRef = collection(firestore, "reminders");
    const qReminders = query(
      remindersRef, 
      where("businessId", "==", businessId),
      where("type", "==", type)
    );
    const reminderSnap = await getDocs(qReminders);
    
    for (const docSnap of reminderSnap.docs) {
      await deleteDoc(doc(firestore, "reminders", docSnap.id));
      deletedCount++;
    }

    // If billing, also clear purchases
    if (type === "billing") {
      const purchasesRef = collection(firestore, "businesses", businessId, "purchases");
      const purchaseSnap = await getDocs(purchasesRef);
      for (const docSnap of purchaseSnap.docs) {
        await deleteDoc(doc(firestore, "businesses", businessId, "purchases", docSnap.id));
        deletedCount++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `Historial de ${type} limpiado con éxito.`,
      deleted: deletedCount 
    });
  } catch (error: any) {
    console.error(`Error clearing ${type} history:`, error);
    res.status(500).json({ error: error.message });
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

export default app;

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Run reminder check every 10 seconds
    setInterval(checkReminders, 10000);
    // Run summary check every hour
    setInterval(sendSummary, 3600000);
  });
}
