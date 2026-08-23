import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./data/firebase-config";

// Until the config is filled in, the site still runs - the stories tab just says "not set up yet".
export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export const login = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);
