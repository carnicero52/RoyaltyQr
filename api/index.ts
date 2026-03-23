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

  // API Routes
  app.post("/api/notify", async (req, res) => {
    const { type, data, config, message: customMessage, subject: customSubject, toEmail, toPhone, toTelegram } = req.body;
    
    const message = customMessage || `
      🔔 Fideliza Notification: ${type}
      
      Details:
      ${JSON.stringify(data, null, 2)}
    `;

    const subject = customSubject || `Fideliza: ${type}`;

    try {
      // Email Notification
      if (config.email && (toEmail || config.email) && process.env.GMAIL_USER) {
        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: toEmail || config.email,
          subject: subject,
          text: message,
        });
      }

      // Telegram Notification
      if (config.telegram && (toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID)) {
        const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = toTelegram || config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
          const tBot = new TelegramBot(token, { polling: false });
          await tBot.sendMessage(chatId, message);
        }
      }

      // WhatsApp Notification (CallMeBot)
      if (config.whatsapp && (toPhone || config.whatsappPhone) && config.whatsappApiKey) {
        const phone = toPhone || config.whatsappPhone;
        const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${config.whatsappApiKey}`;
        await fetch(url);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // Simple Scheduler for Reminders
  setInterval(async () => {
    const now = new Date().toISOString();
    try {
      const remindersSnapshot = await db.collectionGroup("reminders")
        .where("status", "==", "pending")
        .where("scheduledAt", "<=", now)
        .get();

      for (const doc of remindersSnapshot.docs) {
        const reminder = doc.data();
        const businessDoc = await db.collection("businesses").doc(reminder.businessId).get();
        const business = businessDoc.data();

        if (!business) continue;

        const config = {
          email: business.ownerEmail,
          telegram: !!business.telegramChatId,
          telegramToken: business.telegramToken,
          telegramChatId: business.telegramChatId,
          whatsapp: !!business.whatsappEnabled,
          whatsappPhone: business.whatsappPhone,
          whatsappApiKey: business.whatsappApiKey,
        };

        // If reminder has specific customers, send to them
        if (reminder.customerIds && reminder.customerIds.length > 0) {
          for (const customerId of reminder.customerIds) {
            const customerDoc = await db.collection("businesses").doc(reminder.businessId).collection("customers").doc(customerId).get();
            const customer = customerDoc.data();
            if (customer) {
              await fetch(`http://localhost:${PORT}/api/notify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
                  message: reminder.message,
                  subject: reminder.subject,
                  config,
                  toEmail: customer.email,
                  toPhone: customer.phone,
                }),
              });
            }
          }
        } else {
          // Send to business owner if no specific customers
          await fetch(`http://localhost:${PORT}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: reminder.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
              message: reminder.message,
              subject: reminder.subject,
              config,
            }),
          });
        }

        // Update status
        await doc.ref.update({ status: "sent" });
      }
    } catch (error) {
      console.error("Scheduler error:", error);
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
