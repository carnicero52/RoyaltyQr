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

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper to get Firebase config
function getFirebaseConfig() {
  // Try environment variables first (preferred for Vercel)
  const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  console.log("[Firebase/Config] Checking environment variables... API Key found:", !!apiKey);
  
  if (apiKey) {
    return {
      apiKey: apiKey,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
      firestoreDatabaseId: process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID
    };
  }

  // Fallback to local file
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    console.log("[Firebase/Config] Checking local file at:", configPath);
    if (fs.existsSync(configPath)) {
      console.log("[Firebase/Config] Found firebase-applet-config.json");
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
      console.warn("[Firebase/Config] firebase-applet-config.json NOT found at:", configPath);
    }
  } catch (err) {
    console.error("[Firebase/Config] Error reading firebase-applet-config.json:", err);
  }
  
  return null;
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
async function sendNotification(type: string, to: string, message: string) {
  console.log(`Sending ${type} notification to ${to}: ${message}`);
  
  if (type === "email") {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject: "Reminder",
      text: message,
    });
  } else if (type === "telegram") {
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: false });
    await bot.sendMessage(to, message);
  } else if (type === "whatsapp") {
    const phone = to.replace(/\+/g, "");
    const apiKey = process.env.WHATSAPP_API_KEY;
    if (apiKey) {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("CallMeBot error:", await response.text());
      } else {
        console.log("WhatsApp notification sent via CallMeBot");
      }
    } else {
      console.warn("WHATSAPP_API_KEY not set, skipping WhatsApp notification");
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

      if (business.ownerEmail) await sendNotification("email", business.ownerEmail, summaryMsg);
      if (business.telegramChatId) await sendNotification("telegram", business.telegramChatId, summaryMsg);
      if (business.whatsappPhone && business.whatsappApiKey) {
        const phone = business.whatsappPhone.replace(/\+/g, "");
        const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(summaryMsg)}&apikey=${business.whatsappApiKey}`;
        await fetch(url);
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
  const q = query(remindersRef, where("scheduledAt", "<=", now), where("sent", "==", false));

  const querySnapshot = await getDocs(q);
  for (const docSnap of querySnapshot.docs) {
    const reminder = docSnap.data();
    const businessId = reminder.businessId;
    
    const businessRef = doc(firestore, "businesses", businessId);
    const businessSnap = await getDocs(query(collection(firestore, "businesses"), where("__name__", "==", businessId)));
    
    if (!businessSnap.empty) {
      const business = businessSnap.docs[0].data();
      
      // Notify business owner about the action
      if (business.ownerEmail) await sendNotification("email", business.ownerEmail, `[NOTIFICACIÓN DUEÑO] Se está procesando un recordatorio: ${reminder.message}`);
      if (business.telegramChatId) await sendNotification("telegram", business.telegramChatId, `[NOTIFICACIÓN DUEÑO] Recordatorio enviado: ${reminder.message}`);
      
      // Notify target customers
      const targetCustomerIds = reminder.customerIds || (reminder.customerId ? [reminder.customerId] : []);
      for (const custId of targetCustomerIds) {
        const custSnap = await getDocs(query(collection(firestore, "businesses", businessId, "customers"), where("__name__", "==", custId)));
        if (!custSnap.empty) {
          const cust = custSnap.docs[0].data();
          
          // Personal Email
          if (cust.email) {
            await sendNotification("email", cust.email, reminder.message);
          }
          
          // Personal Telegram
          if (cust.telegramChatId) {
            try {
              const bot = new TelegramBot(business.telegramToken || process.env.TELEGRAM_BOT_TOKEN!, { polling: false });
              await bot.sendMessage(cust.telegramChatId, reminder.message);
            } catch (err) {
              console.error(`Error sending personal telegram to ${cust.id}:`, err);
            }
          }
          
          // Personal WhatsApp (CallMeBot)
          if (cust.callmebotApiKey) {
            try {
              const phone = cust.phone.replace(/\+/g, "");
              const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(reminder.message)}&apikey=${cust.callmebotApiKey}`;
              await fetch(url);
            } catch (err) {
              console.error(`Error sending personal whatsapp to ${cust.id}:`, err);
            }
          }
        }
      }
      
      await setDoc(doc(firestore, "reminders", docSnap.id), { ...reminder, sent: true }, { merge: true });
    }
  }
}

// API Routes
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    env: {
      hasApiKey: !!process.env.VITE_FIREBASE_API_KEY,
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
        hasEnv: !!process.env.VITE_FIREBASE_API_KEY
      });
    }

    console.log("[API/TestDB] Fetching businesses...");
    const businessesRef = collection(firestore, "businesses");
    const snapshot = await getDocs(businessesRef);
    const businesses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`[API/TestDB] Success: Found ${businesses.length} businesses`);
    res.json({ success: true, count: businesses.length, data: businesses });
  } catch (error: any) {
    console.error("[API/TestDB] Fatal error:", error);
    res.status(500).json({ 
      error: error.message, 
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined 
    });
  }
});

app.post("/api/notify", async (req, res) => {
  const { type, data, config, message, subject, toEmail, toPhone } = req.body;
  console.log(`[API/Notify] Received request for type: ${type}`);

  const results: any = {};
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

  try {
    // Email
    if (toEmail || (config?.email && config?.gmailUser && config?.gmailAppPass)) {
      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: config?.gmailUser || process.env.EMAIL_USER,
            pass: config?.gmailAppPass || process.env.EMAIL_PASS,
          },
        });
        await transporter.sendMail({
          from: config?.gmailUser || process.env.EMAIL_USER,
          to: toEmail || config?.email,
          subject: subject || `Notificación de ${config?.business || "Fideliza"}`,
          text: msg,
        });
        results.email = { success: true };
      } catch (err: any) {
        results.email = { success: false, error: err.message };
      }
    }

    // Telegram
    if (config?.telegramChatId && (config?.telegramToken || process.env.TELEGRAM_BOT_TOKEN)) {
      try {
        const bot = new TelegramBot(config.telegramToken || process.env.TELEGRAM_BOT_TOKEN!, { polling: false });
        await bot.sendMessage(config.telegramChatId, msg);
        results.telegram = { success: true };
      } catch (err: any) {
        results.telegram = { success: false, error: err.message };
      }
    }

    // WhatsApp (CallMeBot)
    if ((toPhone || config?.whatsappPhone) && (config?.whatsappApiKey || process.env.WHATSAPP_API_KEY)) {
      try {
        const phone = (toPhone || config.whatsappPhone).replace(/\+/g, "");
        const apiKey = config.whatsappApiKey || process.env.WHATSAPP_API_KEY;
        const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(msg)}&apikey=${apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
          results.whatsapp = { success: true };
        } else {
          results.whatsapp = { success: false, error: await response.text() };
        }
      } catch (err: any) {
        results.whatsapp = { success: false, error: err.message };
      }
    }

    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/clear-history", async (req, res) => {
  try {
    const firestore = await getDb();
    if (!firestore) return res.status(500).json({ error: "DB not initialized" });

    const remindersRef = collection(firestore, "reminders");
    const q = query(remindersRef, where("sent", "==", true));
    const snapshot = await getDocs(q);
    
    for (const docSnap of snapshot.docs) {
      await deleteDoc(doc(firestore, "reminders", docSnap.id));
    }
    
    res.json({ success: true, deleted: snapshot.size });
  } catch (error: any) {
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
    // Run reminder check every minute
    setInterval(checkReminders, 60000);
    // Run summary check every hour
    setInterval(sendSummary, 3600000);
  });
}
