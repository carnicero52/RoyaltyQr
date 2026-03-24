import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

const app = express();

async function startServer() {
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

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
    console.log(`[Notification] Attempting to send ${type} to ${toEmail || toPhone || toTelegram || 'unknown'}`);
    const message = customMessage || `
      🔔 Fideliza Notification: ${type}
      
      Details:
      ${JSON.stringify(data, null, 2)}
    `;

    const subject = customSubject || `Fideliza: ${type}`;

    try {
      // Email Notification
      if (config.email && (toEmail || config.email)) {
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
          console.log(`[Notification] Sending Email to ${toEmail || config.email}`);
          await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: toEmail || config.email,
            subject: subject,
            text: message,
          });
        } else {
          console.warn("[Notification] GMAIL_USER or GMAIL_PASS not set, skipping email");
        }
      }

      // Telegram Notification
      if (config.telegram && (toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID)) {
        const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
          console.log(`[Notification] Sending Telegram to ${chatId}`);
          const tBot = new TelegramBot(token, { polling: false });
          await tBot.sendMessage(chatId, message);
        } else {
          console.warn("[Notification] Telegram token or chatId not set, skipping telegram");
        }
      }

      // WhatsApp Notification (CallMeBot)
      if (config.whatsapp && (toPhone || config.whatsappPhone) && config.whatsappApiKey) {
        const phone = toPhone || config.whatsappPhone;
        console.log(`[Notification] Sending WhatsApp to ${phone}`);
        const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${config.whatsappApiKey}`;
        await fetch(url);
      } else if (config.whatsapp) {
        console.warn("[Notification] WhatsApp phone or apiKey not set, skipping whatsapp");
      }

      return { success: true };
    } catch (error) {
      console.error("[Notification] Error:", error);
      throw error;
    }
  };

  // API Routes
  app.post("/api/notify", async (req, res) => {
    try {
      await sendNotification(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // Simple Scheduler for Reminders
  setInterval(async () => {
    const now = new Date().toISOString();
    console.log(`[Scheduler] Checking for pending reminders at ${now}`);
    try {
      // Query only by status to avoid needing a composite index on collectionGroup
      const remindersSnapshot = await db.collectionGroup("reminders")
        .where("status", "==", "pending")
        .get();

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
        };

        try {
          // If reminder has specific customers, send to them
          if (reminder.customerIds && reminder.customerIds.length > 0) {
            console.log(`[Scheduler] Sending reminder ${doc.id} to ${reminder.customerIds.length} customers`);
            for (const customerId of reminder.customerIds) {
              const customerDoc = await db.collection("businesses").doc(reminder.businessId).collection("customers").doc(customerId).get();
              const customer = customerDoc.data();
              if (customer) {
                await sendNotification({
                  type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
                  message: reminder.message,
                  subject: reminder.subject,
                  config,
                  toEmail: customer.email,
                  toPhone: customer.phone,
                });
              }
            }
          } else {
            console.log(`[Scheduler] Sending reminder ${doc.id} to business owner`);
            // Send to business owner if no specific customers
            await sendNotification({
              type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
              message: reminder.message,
              subject: reminder.subject,
              config,
            });
          }

          // Update status
          await doc.ref.update({ status: "sent" });
          console.log(`[Scheduler] Reminder ${doc.id} marked as sent`);
        } catch (sendError) {
          console.error(`[Scheduler] Failed to send reminder ${doc.id}:`, sendError);
          await doc.ref.update({ status: "failed" });
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error in interval:", error);
    }
  }, 60000); // Check every minute

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

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
