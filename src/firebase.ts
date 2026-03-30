import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Try to import local config if it exists using Vite's eager glob.
// This ensures it's available synchronously for initializeApp.
const configs = import.meta.glob('../firebase-applet-config.json', { eager: true, import: 'default' });
const localConfig: any = configs['../firebase-applet-config.json'] || {};

console.log("[Firebase/Init] Local config found:", !!configs['../firebase-applet-config.json']);

// In Vercel/Production, we use environment variables.
// In local development, we might have the config file, but we'll prefer env vars if present.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || localConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || localConfig.appId,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || localConfig.firestoreDatabaseId
};

// If environment variables are missing, we can't initialize Firebase.
// We'll log a warning, but the app might still try to load.
if (!firebaseConfig.apiKey) {
  console.error("CRITICAL: Firebase API Key is missing! The app will likely fail to load.");
  console.log("Environment variables found:", Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')));
  console.log("Local config keys:", Object.keys(localConfig));
} else {
  console.log("Firebase config loaded for project:", firebaseConfig.projectId);
  console.log("Firestore Database ID:", firebaseConfig.firestoreDatabaseId || "(default)");
}

let app;
try {
  app = initializeApp(firebaseConfig);
  console.log("Firebase App initialized successfully");
} catch (error) {
  console.error("Error initializing Firebase App:", error);
}

const dbId = firebaseConfig.firestoreDatabaseId;
export const db = (app && dbId && dbId !== "(default)" && dbId !== "") ? getFirestore(app, dbId) : (app ? getFirestore(app) : null as any);
console.log("Firestore instance initialized:", db ? "Success" : "Failed");

export const auth = app ? getAuth(app) : null as any;
export const googleProvider = new GoogleAuthProvider();
