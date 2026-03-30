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
}

const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId || firebaseConfig.projectId;
export const db = (dbId && dbId !== "(default)") ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
