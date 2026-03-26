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

// Health check - Minimal and fast
app.get("/api/health", async (req, res) => {
  let dbStatus = "not_initialized";
  let dbError = null;
  try {
    const firestore = await getDb();
    dbStatus = firestore ? "connected" : "failed";
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

// Lazy Firebase Init Helper
let db: admin.firestore.Firestore | null = null;
const getDb = async () => {
  if (db) return db;
  
  try {
    console.log("[Firebase] Starting initialization...");
    console.log("[Firebase] Config loaded:", !!firebaseConfig);
    console.log("[Firebase] Config ProjectId:", firebaseConfig?.projectId);
    console.log("[Firebase] Env ProjectId:", process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
    
    let serverApp;
    if (admin.apps.length === 0) {
      // Priority 0: Service Account from Environment Variable (Best for Vercel/External)
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
        // Priority 1: Explicit projectId from config
        const configProjectId = firebaseConfig?.projectId;
        // Priority 2: Environment variables
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
        // Test connection
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
    
    // Final verification
    await db.collection("businesses").limit(1).get();
    console.log("[Firebase] Firestore connection verified");
    
    return db;
  } catch (err: any) {
    console.error("[Firebase] Critical Init Error:", err.message);
    
    let detailedError = `Firebase Initialization Failed: ${err.message}.`;
    if (err.message?.includes("Could not load the default credentials")) {
      detailedError += " \n\nINSTRUCTIONS FOR VERCEL: \n1. Go to Firebase Console > Project Settings > Service Accounts. \n2. Click 'Generate new private key'. \n3. Copy the JSON content. \n4. In Vercel, add an environment variable 'FIREBASE_SERVICE_ACCOUNT' and paste the JSON content as the value. \n5. Redeploy your app.";
    }
    
    // Last ditch effort: default everything
    try {
      if (admin.apps.length === 0) {
        admin.initializeApp();
      }
      db = getFirestore(admin.app());
      await db.collection("businesses").limit(1).get();
      return db;
    } catch (lastErr: any) {
      console.error("[Firebase] Last ditch effort failed:", lastErr.message);
      throw new Error(`${detailedError} (Last ditch error: ${lastErr.message}). ProjectId: ${firebaseConfig?.projectId || 'none'}`);
    }
  }
};

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
      projectId: firebaseConfig.projectId || "unknown",
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

  // Simple Scheduler for Reminders
  const checkReminders = async () => {
    const firestore = await getDb();
    if (!firestore) {
      console.warn("[Scheduler] Firestore not initialized yet, skipping check");
      return;
    }
    const now = new Date().toISOString();
    try {
      console.log(`[Scheduler] Checking pending reminders...`);
      
      const businessesSnapshot = await firestore.collection("businesses").get();
      if (businessesSnapshot.empty) {
        console.log("[Scheduler] No businesses found in database.");
        return;
      }
      
      console.log(`[Scheduler] Found ${businessesSnapshot.docs.length} businesses`);
      
      for (const bizDoc of businessesSnapshot.docs) {
        const business = bizDoc.data();
        const remindersSnapshot = await bizDoc.ref.collection("reminders")
          .where("status", "==", "pending")
          .get();

        if (remindersSnapshot.empty) continue;

        for (const doc of remindersSnapshot.docs) {
          const reminder = doc.data();
          if (reminder.scheduledAt > now) continue;

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
    }
  } catch (error: any) {
      console.error("[Scheduler] Error in interval:", error);
      if (error.message?.includes("PERMISSION_DENIED")) {
        console.error("[Scheduler] CRITICAL: Permission Denied. Check if the Firebase project ID in firebase-applet-config.json matches the environment and if the service account has access.");
      }
    }
  };

  // Run once on startup and then every minute
  checkReminders();
  setInterval(checkReminders, 60000);

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
