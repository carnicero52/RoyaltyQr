import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId;
export const db = (dbId && dbId !== "(default)") ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);
