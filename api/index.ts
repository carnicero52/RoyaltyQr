import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// Robust config loading
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("[Firebase] Config loaded from file");
  } else {
    // Try one level up if we're in a subdirectory
    const parentConfigPath = path.join(process.cwd(), "..", "firebase-applet-config.json");
    if (fs.existsSync(parentConfigPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(parentConfigPath, "utf8"));
      console.log("[Firebase] Config loaded from parent directory");
    }
  }
} catch (e) {
  console.warn("[Firebase] Could not load firebase-applet-config.json:", e);
}

const app = express();
app.use(cors());
app.use(express.json());

// Lazy Firebase Init Helper
let db: admin.firestore.Firestore | null = null;
const getDb = async () => {
  if (db) return db;
  
  try {
    console.log("[Firebase] Starting initialization...");
    console.log("[Firebase] Config loaded:", !!firebaseConfig);
    console.log("[Firebase] Config ProjectId:", firebaseConfig?.projectId);
    
    let serverApp;
    if (admin.apps.length === 0) {
      // Priority 0: Service Account from Environment Variable
      const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (serviceAccountVar) {
        try {
          console.log("[Firebase] Attempting initialization with Service Account from ENV...");
          const serviceAccount = JSON.parse(serviceAccountVar);
          serverApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: firebaseConfig?.storageBucket || `${serviceAccount.project_id}.appspot.com`
          });
          console.log("[Firebase] Initialized with Service Account from ENV");
        } catch (e: any) {
          console.error("[Firebase] Service Account ENV init failed:", e.message);
        }
      }

      if (!serverApp) {
        const configProjectId = firebaseConfig?.projectId;
        const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
        const finalProjectId = (configProjectId && configProjectId !== "TODO_PROJECT_ID") ? configProjectId : envProjectId;
        
        if (finalProjectId) {
          try {
            console.log("[Firebase] Attempting initialization with projectId:", finalProjectId);
            serverApp = admin.initializeApp({ 
              projectId: finalProjectId,
              storageBucket: firebaseConfig?.storageBucket
            });
            console.log("[Firebase] Initialized with explicit projectId:", finalProjectId);
          } catch (e: any) {
            console.warn("[Firebase] Explicit init failed, trying default:", e.message);
            try {
              serverApp = admin.initializeApp();
              console.log("[Firebase] Initialized with default credentials");
            } catch (defaultErr: any) {
              console.error("[Firebase] Default initialization failed:", defaultErr.message);
              throw defaultErr;
            }
          }
        } else {
          console.log("[Firebase] No valid projectId found, trying default initialization...");
          try {
            serverApp = admin.initializeApp();
            console.log("[Firebase] Initialized with default credentials");
          } catch (e: any) {
            console.error("[Firebase] Default initialization failed:", e.message);
            throw e;
          }
        }
      }
    } else {
      serverApp = admin.app();
      console.log("[Firebase] Using existing app");
    }
    
    const dbId = firebaseConfig?.firestoreDatabaseId;
    const useNamedDb = dbId && dbId !== "(default)";
    
    if (useNamedDb) {
      try {
        console.log(`[Firebase] Connecting to named database: ${dbId}`);
        db = getFirestore(serverApp, dbId);
        await db.collection("businesses").limit(1).get();
        console.log(`[Firebase] Connected to named database: ${dbId}`);
      } catch (err: any) {
        console.warn(`[Firebase] Named database ${dbId} failed:`, err.message);
        if (err.message?.includes("NOT_FOUND") || err.message?.includes("database not found") || err.code === 5) {
          console.log("[Firebase] Falling back to (default) database...");
          db = getFirestore(serverApp);
        } else {
          throw err;
        }
      }
    } else {
      console.log("[Firebase] Using (default) database");
      db = getFirestore(serverApp);
    }
    
    await db.collection("businesses").limit(1).get();
    console.log("[Firebase] Firestore connection verified");
    
    return db;
  } catch (err: any) {
    console.error("[Firebase] Critical Init Error:", err.message);
    throw err;
  }
};

// Notification Logic
// Notification Logic
const sendNotification = async ({ type, data, config, message: customMessage, subject: customSubject, toEmail, toPhone, toTelegram }: any) => {
  const results: any = { email: null, telegram: null, whatsapp: null };
  const target = toEmail || toPhone || toTelegram || 'business owner';
  console.log(`[Notification] [${new Date().toISOString()}] Attempting to send "${type}" to ${target}`);
  
  const message = customMessage || `
    🔔 Fideliza Notification: ${type}
    
    Details:
    ${JSON.stringify(data, null, 2)}
  `;

  const subject = customSubject || `Fideliza: ${type}`;

  // Email Notification
  const emailTarget = toEmail || (type === "System" ? config.email : null);
  if (emailTarget && emailTarget.trim() !== "") {
    const gUser = config.gmailUser || process.env.GMAIL_USER;
    const gPass = config.gmailAppPass || process.env.GMAIL_PASS;

    if (gUser && gPass) {
      try {
        console.log(`[Notification] [Email] Sending to ${emailTarget} via ${gUser}`);
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: gUser, pass: gPass },
        });

        await transporter.sendMail({
          from: gUser,
          to: emailTarget,
          subject: subject,
          text: message,
        });
        results.email = { success: true };
        console.log(`[Notification] [Email] SUCCESS: Sent to ${emailTarget}`);
      } catch (err: any) {
        console.error(`[Notification] [Email] ERROR for ${emailTarget}:`, err.message);
        results.email = { success: false, error: err.message };
      }
    } else {
      console.warn("[Notification] [Email] SKIP: Credentials missing");
      results.email = { success: false, error: "Email credentials not configured" };
    }
  }

  // Telegram Notification
  if (config.telegram || toTelegram) {
    const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    
    if (token && chatId) {
      try {
        console.log(`[Notification] [Telegram] Sending to ${chatId}`);
        const tBot = new TelegramBot(token, { polling: false });
        await tBot.sendMessage(chatId, message);
        results.telegram = { success: true };
        console.log(`[Notification] [Telegram] SUCCESS: Sent to ${chatId}`);
      } catch (err: any) {
        console.error(`[Notification] [Telegram] ERROR for ${chatId}:`, err.message);
        results.telegram = { success: false, error: err.message };
      }
    } else {
      console.warn("[Notification] [Telegram] SKIP: Token or ChatId missing");
      results.telegram = { success: false, error: "Telegram credentials not configured" };
    }
  }

  // WhatsApp Notification (CallMeBot)
  if (config.whatsapp || toPhone) {
    const phone = toPhone || config.whatsappPhone;
    const apiKey = config.whatsappApiKey;
    
    if (phone && phone.trim() !== "" && apiKey && apiKey.trim() !== "") {
      try {
        const cleanPhone = phone.replace(/\+/g, '').replace(/\s/g, '');
        console.log(`[Notification] [WhatsApp] Sending to ${cleanPhone}`);
        const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
          results.whatsapp = { success: true };
          console.log(`[Notification] [WhatsApp] SUCCESS: Sent to ${cleanPhone}`);
        } else {
          const text = await response.text();
          console.error(`[Notification] [WhatsApp] ERROR: CallMeBot returned ${response.status}: ${text}`);
          results.whatsapp = { success: false, error: `CallMeBot error (${response.status}): ${text}` };
        }
      } catch (err: any) {
        console.error(`[Notification] [WhatsApp] ERROR for ${phone}:`, err.message);
        results.whatsapp = { success: false, error: err.message };
      }
    } else if (config.whatsapp) {
      console.warn("[Notification] [WhatsApp] SKIP: Phone or API Key missing");
      results.whatsapp = { success: false, error: "WhatsApp credentials not configured" };
    }
  }

  return results;
};

// Simple Scheduler for Reminders
let isChecking = false;
const checkReminders = async () => {
  if (isChecking) {
    console.log("[Scheduler] Check already in progress, skipping...");
    return;
  }
  isChecking = true;
  
  try {
    const firestore = await getDb();
    if (!firestore) {
      console.warn("[Scheduler] Firestore not initialized yet, skipping check");
      return;
    }
    const now = new Date().toISOString();
    console.log(`[Scheduler] [${now}] START: Checking pending reminders...`);
    
    const businessesSnapshot = await firestore.collection("businesses").get();
    if (businessesSnapshot.empty) {
      console.log("[Scheduler] No businesses found.");
      return;
    }
    
    let processedCount = 0;
    for (const bizDoc of businessesSnapshot.docs) {
      const business = bizDoc.data();
      const remindersSnapshot = await bizDoc.ref.collection("reminders")
        .where("status", "==", "pending")
        .get();

      if (remindersSnapshot.empty) continue;

      for (const doc of remindersSnapshot.docs) {
        const reminder = doc.data();
        
        if (!reminder.scheduledAt) {
          console.warn(`[Scheduler] [${bizDoc.id}] Reminder ${doc.id} has no scheduledAt, skipping.`);
          continue;
        }

        // String comparison works for ISO dates
        if (reminder.scheduledAt > now) {
          console.log(`[Scheduler] [${bizDoc.id}] Reminder ${doc.id} is for the future (${reminder.scheduledAt}). Current UTC: ${now}`);
          continue;
        }

        processedCount++;
        console.log(`[Scheduler] [${bizDoc.id}] Processing reminder ${doc.id} (Scheduled: ${reminder.scheduledAt})`);

        const config = {
          email: business.ownerEmail,
          telegram: !!business.telegramChatId,
          telegramToken: business.telegramToken,
          telegramChatId: business.telegramChatId,
          whatsapp: !!business.whatsappEnabled,
          whatsappPhone: business.whatsappPhone,
          whatsappApiKey: business.whatsappApiKey,
          gmailUser: business.gmailUser,
          gmailAppPass: business.gmailAppPass,
        };

        try {
          let anySuccess = false;
          let errors: string[] = [];

          if (reminder.customerIds && reminder.customerIds.length > 0) {
            console.log(`[Scheduler] [${bizDoc.id}] Sending to ${reminder.customerIds.length} customers`);
            for (const customerId of reminder.customerIds) {
              const customerDoc = await bizDoc.ref.collection("customers").doc(customerId).get();
              const customer = customerDoc.data();
              if (customer) {
                const results = await sendNotification({
                  type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
                  message: reminder.message,
                  subject: reminder.subject,
                  config,
                  toEmail: customer.email,
                  toPhone: customer.phone,
                });
                
                Object.entries(results).forEach(([method, res]: [string, any]) => {
                  if (res) {
                    if (res.success) anySuccess = true;
                    else errors.push(`${customer.name || customer.phone} (${method}): ${res.error}`);
                  }
                });
              }
            }
          } else {
            console.log(`[Scheduler] [${bizDoc.id}] Sending to business owner`);
            const results = await sendNotification({
              type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
              message: reminder.message,
              subject: reminder.subject,
              config,
            });
            Object.entries(results).forEach(([method, res]: [string, any]) => {
              if (res) {
                if (res.success) anySuccess = true;
                else errors.push(`Owner (${method}): ${res.error}`);
              }
            });
          }

          const statusMessage = errors.length > 0 ? [...new Set(errors)].join(", ").substring(0, 500) : undefined;
          if (anySuccess) {
            await doc.ref.update({ 
              status: "sent",
              statusMessage: statusMessage || "Enviado con éxito"
            });
            console.log(`[Scheduler] [${bizDoc.id}] SUCCESS: Reminder ${doc.id} marked as sent`);
          } else {
            await doc.ref.update({ 
              status: "failed",
              statusMessage: statusMessage || "No se pudo enviar por ningún medio configurado"
            });
            console.warn(`[Scheduler] [${bizDoc.id}] FAILED: Reminder ${doc.id} marked as failed`);
          }
        } catch (sendError: any) {
          console.error(`[Scheduler] [${bizDoc.id}] CRITICAL ERROR for reminder ${doc.id}:`, sendError.message);
          await doc.ref.update({ 
            status: "failed",
            statusMessage: `Error crítico: ${sendError.message}`
          });
        }
      }
    }
    console.log(`[Scheduler] [${now}] END: Processed ${processedCount} reminders.`);
  } catch (error: any) {
    console.error("[Scheduler] CRITICAL ERROR in checkReminders:", error);
  } finally {
    isChecking = false;
  }
};

// Health check - Minimal and fast
app.get("/api/health", async (req, res) => {
  let dbStatus = "not_initialized";
  let dbError = null;
  try {
    const firestore = await getDb();
    dbStatus = firestore ? "connected" : "failed";
    
    // Trigger scheduler on health check to ensure it runs in serverless environments
    if (firestore) {
      checkReminders().catch(e => console.error("[HealthCheck] Scheduler trigger failed:", e));
    }
  } catch (e: any) {
    dbStatus = "error";
    dbError = e.message;
  }

  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    projectId: firebaseConfig?.projectId || "unknown",
    dbStatus,
    dbError,
    isVercel: !!process.env.VERCEL,
    envProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "none"
  });
});

// API Routes
app.get("/api/test-db", async (req, res) => {
  const path = "businesses";
  try {
    const firestore = await getDb();
    if (!firestore) throw new Error("Firestore not initialized");
    const snapshot = await firestore.collection(path).limit(1).get();
    res.json({ 
      success: true, 
      message: "Firestore connection successful", 
      count: snapshot.docs.length,
      projectId: firebaseConfig.projectId
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/notify", async (req, res) => {
  try {
    const results = await sendNotification(req.body);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/process-reminders", async (req, res) => {
  try {
    console.log("[API] Manual reminder check triggered");
    await checkReminders();
    res.json({ success: true, message: "Reminder check completed" });
  } catch (error: any) {
    console.error("[API] Manual reminder check failed:", error);
    res.status(500).json({ success: false, error: error.message });
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

  // Only listen if NOT on Vercel
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  } else {
    console.log("[Server] Running in Vercel environment, skipping app.listen");
  }
}

startServer();

export default app;
