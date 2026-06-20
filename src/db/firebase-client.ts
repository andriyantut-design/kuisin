import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

// Standard login helper
export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleAuthProvider);
    const token = await result.user.getIdToken();
    return { user: result.user, token };
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

export const logout = async () => {
  await signOut(auth);
};
