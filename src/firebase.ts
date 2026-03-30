import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// In Vercel/Production, we use environment variables.
// In local development, we might have the config file, but we'll prefer env vars if present.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID
};

// If environment variables are missing, we can't initialize Firebase.
// We'll log a warning, but the app might still try to load.
if (!firebaseConfig.apiKey) {
  console.warn("Firebase configuration missing! Ensure environment variables are set.");
  console.log("Environment variables found:", Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')));
} else {
  console.log("Firebase initialized with project:", firebaseConfig.projectId);
  console.log("Firestore Database ID:", firebaseConfig.firestoreDatabaseId || "(default)");
}

const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId;
export const db = (dbId && dbId !== "(default)" && dbId !== "") ? getFirestore(app, dbId) : getFirestore(app);
console.log("Firestore instance initialized:", db ? "Success" : "Failed");
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
