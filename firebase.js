import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDPnQ7vMhQ99Uv7t08cvWmcdccUFQ9kg-M",
  authDomain: "cuentasfermat.firebaseapp.com",
  projectId: "cuentasfermat",
  storageBucket: "cuentasfermat.firebasestorage.app",
  messagingSenderId: "117764638685",
  appId: "1:117764638685:web:d1673976e39935a5109834",
  measurementId: "G-D3K8Z4TB43"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Erreur setPersistence :", error);
});

export { 
  app, auth, db, storage,
  onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, deleteDoc,
  ref, uploadBytes, getDownloadURL, deleteObject
};
