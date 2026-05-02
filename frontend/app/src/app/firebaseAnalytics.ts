import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDwV6-nRnXBo698L0b4lF33cUTDqRhykHI",
  authDomain: "ktv420.firebaseapp.com",
  projectId: "ktv420",
  storageBucket: "ktv420.firebasestorage.app",
  messagingSenderId: "250797621100",
  appId: "1:250797621100:web:5b35de18afddf2268ebd49",
  measurementId: "G-6FXQQ0V83D",
} satisfies FirebaseOptions;

let analyticsPromise: Promise<Analytics | null> | undefined;

async function getFirebaseAnalytics() {
  if (typeof window === "undefined") {
    return null;
  }

  analyticsPromise ??= isSupported()
    .then((supported) => {
      if (!supported) {
        return null;
      }

      const app = getApps()[0] ?? initializeApp(firebaseConfig);
      return getAnalytics(app);
    })
    .catch((error: unknown) => {
      console.warn("Firebase Analytics unavailable", error);
      return null;
    });

  return analyticsPromise;
}

export async function logPageView(path: string, title: string) {
  const analytics = await getFirebaseAnalytics();

  if (!analytics) {
    return;
  }

  logEvent(analytics, "page_view", {
    page_location: window.location.href,
    page_path: path,
    page_title: title,
  });
}
