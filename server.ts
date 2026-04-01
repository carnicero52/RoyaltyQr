import express from "express";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import cors from "cors";
import { formatInTimeZone } from "date-fns-tz";

import { initializeApp as initializeClientApp, getApps as getClientApps, getApp as getClientApp } from "firebase/app";
import { getFirestore as getClientFirestore, collection, query, where, getDocs, updateDoc, doc, serverTimestamp, getDoc, limit as clientLimit } from "firebase/firestore";

console.log("[Server] Initializing server.ts module...");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper to get Firebase config
function getFirebaseConfig() {
  console.log("[Firebase/Config] Checking environment variables...");
  console.log("[Firebase/Config] VITE_FIREBASE_PROJECT_ID:", process.env.VITE_FIREBASE_PROJECT_ID);
  console.log("[Firebase/Config] FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
  console.log("[Firebase/Config] GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT);

  let localConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      localConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log("[Firebase/Config] Loaded local config:", {
        projectId: localConfig.projectId,
        firestoreDatabaseId: localConfig.firestoreDatabaseId
      });
    }
  } catch (err) {
    console.error("[Firebase/Config] Error reading local config:", err);
  }

  const config = {
    projectId: localConfig.projectId || process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    firestoreDatabaseId: localConfig.firestoreDatabaseId || process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID,
    apiKey: localConfig.apiKey || process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    authDomain: localConfig.authDomain || process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    appId: localConfig.appId || process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    storageBucket: localConfig.storageBucket || process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: localConfig.messagingSenderId || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID
  };

  console.log("[Firebase/Config] Final resolved config:", {
    ...config,
    apiKey: config.apiKey ? "***" : undefined
  });
  if (!config.projectId) {
    console.error("[Firebase/Config] No project ID found in local config or environment variables!");
  }
  return config.projectId ? config : null;
}

// Initialize Firebase SDKs
let dbPromise: Promise<any> | null = null;

async function getDb() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const config = getFirebaseConfig();
    if (!config) {
      console.error("[Firebase/Config] No config found, cannot initialize DB.");
      dbPromise = null;
      return null;
    }

    const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" && config.firestoreDatabaseId !== ""
      ? config.firestoreDatabaseId 
      : "(default)";

    // In this environment, we prefer the Client SDK on the server because we have the apiKey
    // and the Admin SDK often lacks service account credentials.
    console.log("[Firebase/Init] Initializing Client SDK as primary...");
    try {
      const clientConfig = {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId
      };
      
      let clientApp;
      if (getClientApps().length === 0) {
        clientApp = initializeClientApp(clientConfig);
      } else {
        clientApp = getClientApp();
      }
      
      const clientDb = (dbId && dbId !== "(default)") ? getClientFirestore(clientApp, dbId) : getClientFirestore(clientApp);
      (clientDb as any).isClientSDK = true;
      
      // Test connection
      console.log("[Firebase/Client] Testing connection...");
      const testCol = collection(clientDb, "businesses");
      const q = query(testCol, clientLimit(1));
      await getDocs(q);
      console.log("[Firebase/Client] Connection test SUCCESS.");
      
      return clientDb;
    } catch (clientError: any) {
      console.warn("[Firebase/Client] Client SDK failed, trying Admin SDK as backup:", clientError.message);
      
      try {
        let adminApp;
        if (getApps().length === 0) {
          adminApp = initializeApp({
            projectId: config.projectId
          });
        } else {
          adminApp = getApp();
        }
        
        const adminDb = getFirestore(adminApp, dbId === "(default)" ? undefined : dbId);
        (adminDb as any).isClientSDK = false;
        
        console.log("[Firebase/Admin] Testing connection...");
        await adminDb.collection("businesses").limit(1).get();
        console.log("[Firebase/Admin] Admin SDK connection SUCCESS.");
        
        return adminDb;
      } catch (adminError: any) {
        console.error("[Firebase/Admin] Both SDKs failed to initialize/connect.");
        dbPromise = null;
        return null;
      }
    }
  })();

  return dbPromise;
}

// Firestore Helpers to handle both Admin and Client SDKs
async function getCollection(path: string, db: any) {
  if (db.isClientSDK) {
    return collection(db, path);
  }
  return db.collection(path);
}

async function getDocRef(collectionPath: string, docId: string, db: any) {
  if (db.isClientSDK) {
    return doc(db, collectionPath, docId);
  }
  return db.collection(collectionPath).doc(docId);
}

async function fetchDocs(ref: any, db: any) {
  if (db.isClientSDK) {
    const snap = await getDocs(ref);
    return snap.docs;
  }
  const snap = await ref.get();
  return snap.docs;
}

async function fetchDoc(ref: any, db: any) {
  if (db.isClientSDK) {
    const snap = await getDoc(ref);
    return snap;
  }
  const snap = await ref.get();
  return snap;
}

async function updateDocument(ref: any, data: any, db: any) {
  if (db.isClientSDK) {
    return await updateDoc(ref, data);
  }
  return await ref.update(data);
}

async function queryDocs(colRef: any, field: string, op: any, value: any, db: any) {
  if (db.isClientSDK) {
    const q = query(colRef, where(field, op, value));
    const snap = await getDocs(q);
    return snap.docs;
  }
  const snap = await colRef.where(field, op, value).get();
  return snap.docs;
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
  try {
    const firestore = await getDb();
    if (!firestore) {
      console.error("[Cron] sendSummary: Firestore not initialized.");
      return;
    }

    console.log(`[Cron] sendSummary: Using ${firestore.isClientSDK ? "Client" : "Admin"} SDK`);

    const businessesCol = await getCollection("businesses", firestore);
    const businessesDocs = await fetchDocs(businessesCol, firestore);
    
    for (const bDoc of businessesDocs) {
      const business = bDoc.data();
      // Use notificationsEnabled as a master switch if notifySummary is not explicitly set
      if (business.notifySummary === false) continue;
      if (!business.notificationsEnabled && !business.notifySummary) continue;

      const tz = business.timezone || "America/Caracas";
      const nowInTz = formatInTimeZone(new Date(), tz, "HH:mm");
      const hour = parseInt(nowInTz.split(":")[0]);
      const minute = parseInt(nowInTz.split(":")[1]);

      // Send summary between 8:00 PM and 8:15 PM
      if (hour === 20 && minute < 15) {
        const lastSummaryKey = `last_summary_${bDoc.id}_${formatInTimeZone(new Date(), tz, "yyyy-MM-dd")}`;
        if ((global as any)[lastSummaryKey]) continue;

        console.log(`[Cron] Sending summary for ${business.name}`);
        (global as any)[lastSummaryKey] = true;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString();
        
        const purchasesCol = firestore.isClientSDK 
          ? collection(firestore, "businesses", bDoc.id, "purchases")
          : firestore.collection("businesses").doc(bDoc.id).collection("purchases");
        
        const purchasesDocs = await queryDocs(purchasesCol, "timestamp", ">=", todayIso, firestore);

        const count = purchasesDocs.length;
        const msg = `📊 Resumen Diario - ${business.name}\n\nTotal de compras hoy: ${count}\n¡Buen trabajo!`;
        
        if (business.notifyTelegram && business.telegramChatId) {
          await sendNotification("telegram", business.telegramChatId, msg, business);
        }
        if (business.notifyEmail && business.ownerEmail) {
          await sendNotification("email", business.ownerEmail, msg, business, "Resumen Diario");
        }
      }
    }
  } catch (error: any) {
    console.error("[Cron] Error in sendSummary:", error.message || error);
    if (error.stack) console.error(error.stack);
  }
}

// Check reminders
async function checkReminders() {
  console.log("[Cron] Checking reminders...");
  try {
    const firestore = await getDb();
    if (!firestore) {
      console.error("[Cron] checkReminders: Firestore not initialized.");
      return;
    }

    console.log(`[Cron] checkReminders: Using ${firestore.isClientSDK ? "Client" : "Admin"} SDK`);

    const now = new Date();
    
    // Get pending reminders
    const remindersCol = await getCollection("reminders", firestore);
    const pendingDocs = await queryDocs(remindersCol, "status", "==", "pending", firestore);

    console.log(`[Cron] Found ${pendingDocs.length} pending reminders.`);

    if (pendingDocs.length === 0) {
      return;
    }

    for (const docSnap of pendingDocs) {
      const reminderId = docSnap.id;
      if (processingReminders.has(reminderId)) {
        console.log(`[Cron] Reminder ${reminderId} is already being processed.`);
        continue;
      }
      
      const reminder = docSnap.data();
      console.log(`[Cron] Checking reminder ${reminderId}: scheduledAt=${reminder.scheduledAt}, status=${reminder.status}`);
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
        console.log(`[Cron] Processing reminder: ${reminderId} (Scheduled: ${scheduledTime.toISOString()}, Now: ${now.toISOString()})`);

        try {
          // Fetch business config
          const businessRef = await getDocRef("businesses", reminder.businessId, firestore);
          const businessSnap = await fetchDoc(businessRef, firestore);
          const business = businessSnap.data();

          if (!business) {
            throw new Error(`Business ${reminder.businessId} not found.`);
          }

          // Fetch customer data
          const customerIds = reminder.customerIds || (reminder.customerId ? [reminder.customerId] : []);
          if (customerIds.length === 0) {
            throw new Error(`No customers found for reminder ${reminderId}`);
          }

          const results: any[] = [];
          let successCount = 0;

          for (const customerId of customerIds) {
            try {
              const customerRef = firestore.isClientSDK 
                ? doc(firestore, "businesses", reminder.businessId, "customers", customerId)
                : firestore.collection("businesses").doc(reminder.businessId).collection("customers").doc(customerId);
              const customerSnap = await fetchDoc(customerRef, firestore);
              const customer = customerSnap.data();

              if (!customer) {
                console.warn(`[Cron] Customer ${customerId} not found for reminder ${reminderId}`);
                results.push({ customerId, status: "error", error: "Customer not found" });
                continue;
              }

              // Determine notification methods
              const methods = [];
              // Check if credentials exist and if the method is enabled (default to enabled if credentials exist)
              if (business.gmailUser && business.gmailAppPass && (customer.email || business.ownerEmail)) {
                if (business.notifyEmail !== false) methods.push("email");
              }
              if (business.telegramToken && business.telegramChatId) {
                if (business.notifyTelegram !== false) methods.push("telegram");
              }
              if (business.whatsappEnabled && business.whatsappApiKey && (customer.phone || business.whatsappPhone)) {
                if (business.notifyWhatsapp !== false) methods.push("whatsapp");
              }

              for (const method of methods) {
                try {
                  const to = method === "email" ? (customer.email || business.ownerEmail) : 
                             method === "telegram" ? business.telegramChatId : 
                             (customer.phone || business.whatsappPhone);
                  
                  if (!to) {
                    console.warn(`[Cron] No destination for ${method} to customer ${customerId}`);
                    continue;
                  }

                  await sendNotification(method, to, reminder.message, business, reminder.subject);
                  results.push({ customerId, method, status: "success" });
                  successCount++;
                } catch (err: any) {
                  console.error(`[Cron] Error sending ${method} to ${customerId}:`, err.message);
                  results.push({ customerId, method, status: "error", error: err.message });
                }
              }
            } catch (err: any) {
              console.error(`[Cron] Error processing customer ${customerId}:`, err.message);
              results.push({ customerId, status: "error", error: err.message });
            }
          }

          // Update reminder status
          const finalStatus = successCount > 0 ? "sent" : "failed";
          const updateData = {
            status: finalStatus,
            sentAt: firestore.isClientSDK ? serverTimestamp() : FieldValue.serverTimestamp(),
            results
          };
          
          if (firestore.isClientSDK) {
            await updateDoc(docSnap.ref as any, updateData);
          } else {
            await (docSnap.ref as any).update(updateData);
          }

          // Notify admin if it failed completely
          if (finalStatus === "failed" && business.telegramChatId) {
            try {
              await sendNotification("telegram", business.telegramChatId, `⚠️ Error al enviar recordatorio "${reminder.subject || 'Sin asunto'}": No se pudo enviar a ningún cliente.`, business);
            } catch (e) {}
          }

        } catch (err: any) {
          console.error(`[Cron] Fatal error processing reminder ${reminderId}:`, err);
          const errorData = {
            status: "error",
            error: err.message
          };
          if (firestore.isClientSDK) {
            await updateDoc(docSnap.ref as any, errorData);
          } else {
            await (docSnap.ref as any).update(errorData);
          }
        } finally {
          processingReminders.delete(reminderId);
        }
      } else {
        console.log(`[Cron] Skipping reminder ${reminderId}: Not time yet (Scheduled: ${scheduledTime.toISOString()}, Now: ${now.toISOString()})`);
      }
    }
  } catch (error: any) {
    console.error("[Cron] Error in checkReminders:", error.message || error);
    if (error.stack) console.error(error.stack);
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
  res.json({ status: "ok", sdk: "admin" });
});

app.get("/api/test-db", async (req, res) => {
  try {
    console.log("[API/TestDB] Initializing DB...");
    const firestore = await getDb();
    if (!firestore) {
      console.error("[API/TestDB] DB initialization failed");
      return res.status(500).json({ 
        error: "DB not initialized"
      });
    }

    const dbInfo = {
      projectId: firestore.isClientSDK ? firestore.app.options.projectId : getApp().options.projectId,
      databaseId: firestore.databaseId || "(default)",
      isClientSDK: firestore.isClientSDK
    };
    
    console.log("[API/TestDB] Fetching businesses...");
    const businessesCol = await getCollection("businesses", firestore);
    const businessesDocs = await fetchDocs(businessesCol, firestore);
    console.log("[API/TestDB] Found businesses:", businessesDocs.length);
    
    res.json({ 
      success: true,
      status: "ok", 
      db: dbInfo,
      count: businessesDocs.length,
      businesses: businessesDocs.map(d => ({ id: d.id, name: d.data().name }))
    });
  } catch (error: any) {
    console.error("[API/TestDB] Error:", error);
    res.status(500).json({ 
      error: error.message
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

async function getAdminDb() {
  const config = getFirebaseConfig();
  if (!config) return null;

  const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" && config.firestoreDatabaseId !== ""
    ? config.firestoreDatabaseId 
    : undefined;

  try {
    const apps = getApps();
    let adminApp;
    if (apps.length === 0) {
      adminApp = initializeApp({
        projectId: config.projectId
      });
    } else {
      adminApp = apps[0];
    }
    
    const adminDb = dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
    (adminDb as any).isClientSDK = false;
    return adminDb;
  } catch (err) {
    console.error("[Firebase/Admin] Failed to get Admin DB:", err);
    return null;
  }
}

app.post("/api/clear-history/:type", async (req, res) => {
  const { type } = req.params;
  const { businessId } = req.body;

  console.log(`[API/ClearHistory] Request to clear ${type} for business ${businessId}`);

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }

  try {
    // Force Admin SDK for deletion to bypass security rules
    const firestore: any = await getAdminDb();
    
    if (!firestore) {
      console.error("[API/ClearHistory] Admin SDK failed to initialize.");
      return res.status(500).json({ error: "No se pudo inicializar el acceso administrativo para borrar datos." });
    }

    let deletedCount = 0;
    const docsToDelete: any[] = [];

    // 1. Collect reminders
    const remindersSnap = await firestore.collection("reminders")
      .where("businessId", "==", businessId)
      .get();
    
    remindersSnap.docs.forEach((docSnap: any) => {
      const data = docSnap.data();
      // Match by type, or default to billing if no type exists (legacy)
      if (data.type === type || (type === "billing" && !data.type)) {
        docsToDelete.push(docSnap.ref);
      }
    });

    // 2. Collect purchases (only for billing)
    if (type === "billing") {
      const purchasesSnap = await firestore.collection("businesses")
        .doc(businessId)
        .collection("purchases")
        .get();
      
      purchasesSnap.docs.forEach((docSnap: any) => {
        docsToDelete.push(docSnap.ref);
      });
    }

    console.log(`[API/ClearHistory] Found ${docsToDelete.length} documents to delete.`);

    // 3. Delete in batches of 500 (Firestore limit)
    for (let i = 0; i < docsToDelete.length; i += 500) {
      const batch = firestore.batch();
      const chunk = docsToDelete.slice(i, i + 500);
      chunk.forEach((ref: any) => {
        batch.delete(ref);
        deletedCount++;
      });
      await batch.commit();
    }

    res.json({ 
      success: true, 
      message: `Historial de ${type === "billing" ? "cobranzas" : "marketing"} limpiado con éxito (${deletedCount} registros).`,
      deleted: deletedCount 
    });
  } catch (error: any) {
    console.error(`[API/ClearHistory] Error clearing ${type} history:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: "Asegúrate de que el servidor tenga permisos de administrador en Firebase."
    });
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
