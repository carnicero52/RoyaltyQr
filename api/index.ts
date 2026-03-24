import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Load config using fs for better ESM compatibility
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Force environment variables BEFORE any other imports
process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;
process.env.GCLOUD_PROJECT = firebaseConfig.projectId;
process.env.FIRESTORE_PROJECT_ID = firebaseConfig.projectId;

dotenv.config();

// Initialize Firebase Admin
let serverApp: admin.app.App | null = null;
try {
  if (admin.apps.length === 0) {
    serverApp = admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log("[Firebase] Admin SDK initialized (Default App)");
  } else {
    serverApp = admin.app();
    console.log("[Firebase] Using existing Admin SDK app");
  }
} catch (err: any) {
  console.error("[Firebase] Initialization Error:", err);
}

// Initialize Firestore
let db: admin.firestore.Firestore | null = null;
if (serverApp) {
  try {
    const dbId = firebaseConfig.firestoreDatabaseId;
    db = (dbId && dbId !== "(default)") ? getFirestore(serverApp, dbId) : getFirestore(serverApp);
    console.log(`[Firebase] Firestore initialized (DB: ${dbId || 'default'})`);
  } catch (err: any) {
    console.error("[Firebase] Firestore Initialization Error:", err);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Health check at top level to ensure it always works
app.get("/api/health", (req, res) => {
  try {
    const healthData = { 
      status: "ok", 
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      firebaseInitialized: !!serverApp,
      firestoreInitialized: !!db,
      projectId: serverApp?.options?.projectId || "unknown",
      databaseId: firebaseConfig?.firestoreDatabaseId || "none",
      hasGmailEnv: !!(process.env.GMAIL_USER && process.env.GMAIL_PASS),
      hasTelegramEnv: !!process.env.TELEGRAM_BOT_TOKEN
    };
    res.json(healthData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Unknown error in health check" });
  }
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[Global Error]", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

async function startServer() {
  const PORT = 3000;

  // Email Transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  // Notification Logic
  const sendNotification = async ({ type, data, config, message: customMessage, subject: customSubject, toEmail, toPhone, toTelegram }: any) => {
    const results: any = { email: null, telegram: null, whatsapp: null };
    console.log(`[Notification] Attempting to send ${type} to ${toEmail || toPhone || toTelegram || 'unknown'}`);
    
    const message = customMessage || `
      🔔 Fideliza Notification: ${type}
      
      Details:
      ${JSON.stringify(data, null, 2)}
    `;

    const subject = customSubject || `Fideliza: ${type}`;

    // Email Notification
    const emailTarget = toEmail || config.email;
    if (emailTarget) {
      const gUser = config.gmailUser || process.env.GMAIL_USER;
      const gPass = config.gmailAppPass || process.env.GMAIL_PASS;

      if (gUser && gPass) {
        try {
          console.log(`[Notification] Sending Email to ${emailTarget} using ${gUser}`);
          
          // Create a temporary transporter if using custom credentials
          const currentTransporter = (config.gmailUser && config.gmailAppPass) 
            ? nodemailer.createTransport({ service: 'gmail', auth: { user: gUser, pass: gPass } })
            : transporter;

          await currentTransporter.sendMail({
            from: gUser,
            to: emailTarget,
            subject: subject,
            text: message,
          });
          results.email = { success: true };
        } catch (err: any) {
          console.error("[Notification] Email Error:", err);
          results.email = { success: false, error: err.message };
        }
      } else {
        console.warn("[Notification] Gmail credentials not set, skipping email");
        results.email = { success: false, error: "Email credentials not configured" };
      }
    }

    // Telegram Notification
    // config.telegram is a boolean indicating if it's enabled for the business
    if (config.telegram || toTelegram) {
      const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      
      if (token && chatId) {
        try {
          console.log(`[Notification] Sending Telegram to ${chatId}`);
          const tBot = new TelegramBot(token, { polling: false });
          await tBot.sendMessage(chatId, message);
          results.telegram = { success: true };
        } catch (err: any) {
          console.error("[Notification] Telegram Error:", err);
          results.telegram = { success: false, error: err.message };
        }
      } else {
        console.warn("[Notification] Telegram token or chatId not set, skipping telegram");
        results.telegram = { success: false, error: "Telegram credentials not configured" };
      }
    }

    // WhatsApp Notification (CallMeBot)
    if (config.whatsapp || toPhone) {
      const phone = toPhone || config.whatsappPhone;
      const apiKey = config.whatsappApiKey;
      
      if (phone && apiKey) {
        try {
          console.log(`[Notification] Sending WhatsApp to ${phone}`);
          const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
          const response = await fetch(url);
          if (response.ok) {
            results.whatsapp = { success: true };
          } else {
            const text = await response.text();
            results.whatsapp = { success: false, error: `CallMeBot returned ${response.status}: ${text}` };
          }
        } catch (err: any) {
          console.error("[Notification] WhatsApp Error:", err);
          results.whatsapp = { success: false, error: err.message };
        }
      } else if (config.whatsapp) {
        console.warn("[Notification] WhatsApp phone or apiKey not set, skipping whatsapp");
        results.whatsapp = { success: false, error: "WhatsApp credentials not configured" };
      }
    }

    return results;
  };

  // Helper for Firestore error diagnostics
  const handleFirestoreError = (error: any, operationType: string, path: string | null) => {
    const errInfo = {
      error: error.message || String(error),
      code: error.code,
      operationType,
      path,
      projectId: serverApp?.options?.projectId || "unknown",
      databaseId: firebaseConfig.firestoreDatabaseId,
      envProject: process.env.GOOGLE_CLOUD_PROJECT
    };
    console.error(`[Firestore Error] ${JSON.stringify(errInfo, null, 2)}`);
    return error;
  };

  // API Routes
  app.get("/api/test-db", async (req, res) => {
    const path = "businesses";
    try {
      if (!db) throw new Error("Firestore not initialized");
      console.log("[Test DB] Attempting to fetch businesses collection...");
      const snapshot = await db.collection(path).limit(1).get();
      res.json({ 
        success: true, 
        message: "Firestore connection successful", 
        count: snapshot.docs.length,
        projectId: serverApp?.options?.projectId || "unknown",
        databaseId: firebaseConfig.firestoreDatabaseId,
        configProjectId: firebaseConfig.projectId,
        appName: serverApp?.name || "none"
      });
    } catch (error: any) {
      handleFirestoreError(error, "get", path);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        projectId: serverApp?.options?.projectId || "unknown",
        databaseId: firebaseConfig.firestoreDatabaseId,
        configProjectId: firebaseConfig.projectId,
        appName: serverApp?.name || "none"
      });
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

  // Simple Scheduler for Reminders
  const checkReminders = async () => {
    if (!db) {
      console.warn("[Scheduler] Skipping check: Firestore not initialized");
      return;
    }
    const now = new Date().toISOString();
    try {
      console.log(`[Scheduler] Checking for pending reminders at ${now}`);
      
      // Log current project/database context for debugging
      console.log(`[Scheduler] Active Project: ${serverApp?.options?.projectId || "unknown"}`);
      console.log(`[Scheduler] Target Database: ${firebaseConfig.firestoreDatabaseId}`);

      // Query only by status to avoid needing a composite index on collectionGroup
      const path = "reminders (collectionGroup)";
      let remindersSnapshot;
      try {
        remindersSnapshot = await db.collectionGroup("reminders")
          .where("status", "==", "pending")
          .get();
      } catch (err) {
        throw handleFirestoreError(err, "collectionGroupQuery", path);
      }

      console.log(`[Scheduler] Found ${remindersSnapshot.docs.length} pending reminders total`);

      for (const doc of remindersSnapshot.docs) {
        const reminder = doc.data();
        
        // Filter by time in memory
        if (reminder.scheduledAt > now) {
          console.log(`[Scheduler] Reminder ${doc.id} is scheduled for ${reminder.scheduledAt}, skipping (now: ${now})`);
          continue;
        }

        console.log(`[Scheduler] Processing reminder ${doc.id} scheduled for ${reminder.scheduledAt}`);
        const businessDoc = await db.collection("businesses").doc(reminder.businessId).get();
        const business = businessDoc.data();

        if (!business) {
          console.log(`[Scheduler] Business ${reminder.businessId} not found for reminder ${doc.id}`);
          continue;
        }

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

          // If reminder has specific customers, send to them
          if (reminder.customerIds && reminder.customerIds.length > 0) {
            console.log(`[Scheduler] Sending reminder ${doc.id} to ${reminder.customerIds.length} customers`);
            for (const customerId of reminder.customerIds) {
              const customerDoc = await db.collection("businesses").doc(reminder.businessId).collection("customers").doc(customerId).get();
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
            console.log(`[Scheduler] Sending reminder ${doc.id} to business owner`);
            // Send to business owner if no specific customers
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

          // Update status
          const statusMessage = errors.length > 0 ? [...new Set(errors)].join(", ") : undefined;
          if (anySuccess) {
            await doc.ref.update({ 
              status: "sent",
              statusMessage: statusMessage
            });
            console.log(`[Scheduler] Reminder ${doc.id} marked as sent ${statusMessage ? 'with warnings' : ''}`);
          } else {
            await doc.ref.update({ 
              status: "failed",
              statusMessage: statusMessage || "No se pudo enviar por ningún medio"
            });
            console.warn(`[Scheduler] Reminder ${doc.id} marked as failed: ${statusMessage}`);
          }
        } catch (sendError: any) {
          console.error(`[Scheduler] Failed to send reminder ${doc.id}:`, sendError);
          await doc.ref.update({ 
            status: "failed",
            statusMessage: sendError.message
          });
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error in interval:", error);
    }
  };

  // Run once on startup and then every minute
  checkReminders();
  setInterval(checkReminders, 60000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
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
      console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  }
}

startServer();

export default app;
