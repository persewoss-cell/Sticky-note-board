import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCvrfJBqhO4R0HTz3itnwmO7OlOlyJD9Ss",
  authDomain: "sticky-note-board-4cefc.firebaseapp.com",
  projectId: "sticky-note-board-4cefc",
  storageBucket: "sticky-note-board-4cefc.firebasestorage.app",
  messagingSenderId: "1081286319215",
  appId: "1:1081286319215:web:678215402087666f60019a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
