import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";

console.log(`[Server] Process started at ${new Date().toISOString()}`);
try {
  fs.appendFileSync("firebase_init.log", `\n--- SERVER START ${new Date().toISOString()} ---\n`);
} catch (e) {}

dotenv.config();

// Dynamic config loading to handle updates without full process restart
const getFirebaseConfig = () => {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return config;
    }
  } catch (e) {
    console.warn("[Firebase] Could not load firebase-applet-config.json:", e);
  }
  return {};
};

const app = express();
app.use(cors());
app.use(express.json());

import { initializeApp as initializeClientApp, getApp, getApps } from "firebase/app";
import { 
  getFirestore as getClientFirestore, 
  doc as getClientDoc, 
  getDoc as getClientDocData,
  collection,
  getDocs,
  query,
  where,
  limit,
  updateDoc,
  writeBatch,
  Firestore
} from "firebase/firestore";

// Lazy Firebase Init Helper
let db: Firestore | null = null;
const getDb = async (): Promise<Firestore> => {
  if (db) return db;
  
  try {
    const firebaseConfig = getFirebaseConfig();
    const dbId = firebaseConfig?.firestoreDatabaseId;
    
    const logResult = (msg: string) => {
      console.log(msg);
      try {
        fs.appendFileSync("firebase_init.log", `${new Date().toISOString()} - ${msg}\n`);
      } catch (e) {}
    };

    logResult("[Firebase] Initializing via Client SDK...");
    
    let clientApp;
    if (getApps().length === 0) {
      clientApp = initializeClientApp(firebaseConfig);
    } else {
      clientApp = getApp();
    }

    const clientDb = getClientFirestore(clientApp, dbId && dbId !== "(default)" ? dbId : undefined);
    
    // Verify connection
    try {
      await getClientDocData(getClientDoc(clientDb, "_health_check_", "ping"));
      logResult("[Firebase] Client SDK SUCCESS: Connection verified.");
    } catch (e: any) {
      logResult(`[Firebase] Client SDK Warning (Connection Test): ${e.message}`);
    }

    db = clientDb;
    return db;
  } catch (err: any) {
    console.error("[Firebase] Critical Init Error:", err.message);
    throw err;
  }
};

// Notification Logic
const sendNotification = async ({ type, data, config, message: customMessage, subject: customSubject, toEmail, toPhone, toTelegram }: any) => {
  const results: any = { email: null, telegram: null, whatsapp: null };
  
  // 1. Email via Nodemailer
  if (toEmail && config.gmailUser && config.gmailAppPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.gmailUser,
          pass: config.gmailAppPass
        }
      });
      await transporter.sendMail({
        from: config.gmailUser,
        to: toEmail,
        subject: customSubject || "Notificación de Fideliza",
        text: customMessage || `Hola ${data?.customer || "Cliente"}, tienes una nueva notificación de ${data?.business || "tu negocio"}.`
      });
      results.email = { success: true };
    } catch (e: any) {
      console.error("[Notification] Email failed:", e.message);
      results.email = { success: false, error: e.message };
    }
  }

  // 2. Telegram
  if (toTelegram && config.telegramToken && config.telegramChatId) {
    try {
      const bot = new TelegramBot(config.telegramToken);
      await bot.sendMessage(config.telegramChatId, customMessage || `Notificación para ${data?.customer || "Cliente"} de ${data?.business || "tu negocio"}`);
      results.telegram = { success: true };
    } catch (e: any) {
      console.error("[Notification] Telegram failed:", e.message);
      results.telegram = { success: false, error: e.message };
    }
  }

  // 3. WhatsApp via CallMeBot (Simple GET request)
  if (toPhone && config.whatsapp && config.whatsappApiKey) {
    try {
      const message = encodeURIComponent(customMessage || `Notificación para ${data?.customer || "Cliente"} de ${data?.business || "tu negocio"}`);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${toPhone}&text=${message}&apikey=${config.whatsappApiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        results.whatsapp = { success: true };
      } else {
        results.whatsapp = { success: false, error: response.statusText };
      }
    } catch (e: any) {
      console.error("[Notification] WhatsApp failed:", e.message);
      results.whatsapp = { success: false, error: e.message };
    }
  }

  return results;
};

// Scheduler Logic
const checkReminders = async () => {
  try {
    const firestore = await getDb();
    const now = new Date().toISOString();
    
    // 1. Get all businesses to check their reminders
    const businessesSnapshot = await getDocs(collection(firestore, "businesses"));
    let totalProcessed = 0;

    for (const businessDoc of businessesSnapshot.docs) {
      const businessId = businessDoc.id;
      const businessConfig = businessDoc.data();
      
      // 2. Get pending reminders for this business
      const remindersQuery = query(
        collection(firestore, `businesses/${businessId}/reminders`),
        where("status", "==", "pending"),
        where("scheduledAt", "<=", now)
      );
      const remindersSnapshot = await getDocs(remindersQuery);

      for (const reminderDoc of remindersSnapshot.docs) {
        const reminderId = reminderDoc.id;
        const reminderData = reminderDoc.data();
        const customerIds = reminderData.customerIds || [];
        
        const notificationResults = [];
        
        for (const customerId of customerIds) {
          const customerDoc = await getClientDocData(getClientDoc(firestore, `businesses/${businessId}/customers/${customerId}`));
          if (customerDoc.exists()) {
            const customerData = customerDoc.data();
            const result = await sendNotification({
              config: {
                gmailUser: businessConfig.gmailUser,
                gmailAppPass: businessConfig.gmailAppPass,
                telegramToken: businessConfig.telegramToken,
                telegramChatId: businessConfig.telegramChatId,
                whatsapp: businessConfig.whatsappEnabled,
                whatsappPhone: businessConfig.whatsappPhone,
                whatsappApiKey: businessConfig.whatsappApiKey
              },
              data: { 
                customer: customerData?.name || customerData?.phone || "Cliente",
                business: businessConfig.name
              },
              message: reminderData.message,
              subject: reminderData.subject,
              toEmail: customerData?.email,
              toPhone: customerData?.phone,
              toTelegram: businessConfig.telegramChatId
            });
            notificationResults.push({ customerId, result });
          }
        }

        // Update reminder status
        await updateDoc(getClientDoc(firestore, `businesses/${businessId}/reminders/${reminderId}`), {
          status: "sent",
          statusMessage: `Procesado el ${new Date().toISOString()}. Resultados: ${JSON.stringify(notificationResults)}`,
          sentAt: new Date().toISOString()
        });
        
        totalProcessed++;
      }
    }
    
    return totalProcessed;
  } catch (error: any) {
    console.error("[Scheduler] CRITICAL ERROR in checkReminders:", error);
    return 0;
  }
};

// API Routes
app.get("/api/health", async (req, res) => {
  try {
    const firestore = await getDb();
    const firebaseConfig = getFirebaseConfig();
    
    res.json({
      status: "ok",
      firebase: {
        configProjectId: firebaseConfig?.projectId || "unknown",
        envProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "none",
        databaseId: firebaseConfig?.firestoreDatabaseId || "(default)",
        connectionVerified: !!firestore
      }
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      error: error.message
    });
  }
});

app.get("/api/test-db", async (req, res) => {
  try {
    const firestore = await getDb();
    const snapshot = await getDocs(collection(firestore, "businesses"));
    res.json({ success: true, count: snapshot.size });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/notify", async (req, res) => {
  try {
    const { type, data, config, message, subject, toEmail, toPhone } = req.body;
    const results = await sendNotification({
      type,
      data,
      config,
      message,
      subject,
      toEmail,
      toPhone,
      toTelegram: config.telegramChatId
    });
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/process-reminders", async (req, res) => {
  try {
    const processedCount = await checkReminders();
    res.json({ success: true, processedCount });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/clear-history/:type", async (req, res) => {
  try {
    const { businessId } = req.body;
    const { type } = req.params;
    const firestore = await getDb();
    
    const batch = writeBatch(firestore);
    
    if (type === "marketing") {
      const snapshot = await getDocs(collection(firestore, `businesses/${businessId}/reminders`));
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
    } else if (type === "billing") {
      const purchasesSnap = await getDocs(collection(firestore, `businesses/${businessId}/purchases`));
      purchasesSnap.docs.forEach(doc => batch.delete(doc.ref));
      
      const remindersQuery = query(
        collection(firestore, `businesses/${businessId}/reminders`),
        where("type", "==", "billing")
      );
      const remindersSnap = await getDocs(remindersQuery);
      remindersSnap.docs.forEach(doc => batch.delete(doc.ref));
    }
    
    await batch.commit();
    res.json({ success: true, message: `Historial de ${type} eliminado con éxito` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/businesses/:ownerUid", async (req, res) => {
  try {
    const firestore = await getDb();
    const q = query(
      collection(firestore, "businesses"),
      where("ownerUid", "==", req.params.ownerUid),
      limit(1)
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return res.status(404).json({ error: "Business not found" });
    }
    
    res.json({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  const PORT = 3000;

  // Run once on startup and then every minute
  checkReminders();
  setInterval(checkReminders, 60000);

  console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}, VERCEL: ${process.env.VERCEL}`);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
