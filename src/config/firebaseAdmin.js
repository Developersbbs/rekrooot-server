import admin from "firebase-admin";
import { ENV } from "./env.js";

let app;

export function getAdminApp() {
  if (app) return app;

  if (!ENV.FIREBASE_PROJECT_ID || !ENV.FIREBASE_CLIENT_EMAIL || !ENV.FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing Firebase Admin environment variables");
  }

  const credentials = {
    projectId: ENV.FIREBASE_PROJECT_ID,
    clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
    privateKey: ENV.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };

  app = admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });

  return app;
}

export function getAdminAuth() {
  return getAdminApp().auth();
}

export function getAdminFirestore() {
  return getAdminApp().firestore();
}
