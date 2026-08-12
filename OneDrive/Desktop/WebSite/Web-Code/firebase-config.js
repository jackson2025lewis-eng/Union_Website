import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBXNwX8k_ZtiIch6jMwDbq7OQzR0qOht4Q",
  authDomain: "liberian-students-association.firebaseapp.com",
  projectId: "liberian-students-association",
  storageBucket: "liberian-students-association.firebasestorage.app",
  messagingSenderId: "648645488688",
  appId: "1:648645488688:web:d2b8b7fd569c533b7d3df5",
  measurementId: "G-293MQDZYV1"
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const auth = getAuth(app);
