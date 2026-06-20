import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth, Auth } from "firebase-admin/auth";
import firebaseConfig from "../../firebase-applet-config.json";

const initializeFirebaseAdmin = (): Auth | null => {
  try {
    if (!getApps().length) {
      const projectId = firebaseConfig?.projectId || process.env.GOOGLE_CLOUD_PROJECT;
      if (projectId) {
        initializeApp({
          projectId,
        });
        console.log("Firebase Admin SDK initialized successfully with projectId:", projectId);
      } else {
        console.warn("WARNING: Firebase projectId is not available. Firebase Admin Auth will be disabled.");
        return null;
      }
    }
    return getAuth();
  } catch (err) {
    console.error("Failed to initialize Firebase Admin SDK:", err);
    return null;
  }
};

export const adminAuth = initializeFirebaseAdmin();

