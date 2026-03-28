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
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  return null;
}

// Initialize Firebase Client SDK
let db: any = null;

async function getDb() {
  if (db) return db;

  const config = getFirebaseConfig();
  if (!config) {
    console.error("Firebase config not found!");
    return null;
  }

  try {
    const firebaseApp = initializeApp(config);
    db = getFirestore(firebaseApp, config.firestoreDatabaseId);
    console.log("Client SDK SUCCESS: Connection verified.");
    return db;
  } catch (error) {
    console.error("Error initializing Client SDK:", error);
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
    // Placeholder for WhatsApp logic
    console.log("WhatsApp notification sent (mock)");
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
      if (business.email) await sendNotification("email", business.email, reminder.message);
      if (business.telegramId) await sendNotification("telegram", business.telegramId, reminder.message);
      if (business.whatsappNumber) await sendNotification("whatsapp", business.whatsappNumber, reminder.message);
      
      await setDoc(doc(firestore, "reminders", docSnap.id), { ...reminder, sent: true }, { merge: true });
    }
  }
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", sdk: "client" });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const firestore = await getDb();
    if (!firestore) return res.status(500).json({ error: "DB not initialized" });

    const businessesRef = collection(firestore, "businesses");
    const snapshot = await getDocs(businessesRef);
    const businesses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    res.json({ success: true, count: businesses.length, data: businesses });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Run reminder check every minute
  setInterval(checkReminders, 60000);
});
