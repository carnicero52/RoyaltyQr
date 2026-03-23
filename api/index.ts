import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

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

  // Telegram Bot
  const bot = process.env.TELEGRAM_BOT_TOKEN 
    ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
    : null;

  // API Routes
  app.post("/api/notify", async (req, res) => {
    const { type, data, config } = req.body;
    
    const message = `
      🔔 Fideliza Notification: ${type}
      
      Details:
      ${JSON.stringify(data, null, 2)}
    `;

    try {
      // Email Notification
      if (config.email && process.env.GMAIL_USER) {
        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: config.email,
          subject: `Fideliza: ${type}`,
          text: message,
        });
      }

      // Telegram Notification
      if (config.telegram && bot && process.env.TELEGRAM_CHAT_ID) {
        await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

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
