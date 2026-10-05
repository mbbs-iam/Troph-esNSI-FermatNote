// ================================================================
//  chat.js — Lycée Skillforge · Hub de Classe
//  Version 2.1 — Reply System (WhatsApp)
// ================================================================

import { db, auth } from "./firebase.js";
import { esc, toast, initials, avatarColor, formatDate, linkify, compressImageToBase64 } from "./utils.js";
import {
  collection, query, orderBy, limit,
  onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// ── État ─────────────────────────────────────────────────────
let currentUser = null;
let unsubscribeChat = null;
let unsubscribeAuth = null;
let isInitialized = false;

// ── État Reply ───────────────────────────────────────────────
let replyState = null; // { msgId, auteurNom, snippet }



const IMGBB_API_KEY = "f11ee06544b643038a4d1f7e4d823924";
const $ = (id) => document.getElementById(id);

// ── Réinitialisation réseau Firestore ─────────────────────────
window.forceResetFirestoreNetwork = function () {
  console.warn("🔄 Rechargement forcé (réseau bloqué)...");
  toast("⚡ Réseau bloqué — rechargement de la page...");
  setTimeout(() => window.location.reload(), 1500);
};

// ── Scroll ────────────────────────────────────────────────────
function scrollToBottom() {
  const c = $("chat-wallpaper");
  if (c) c.scrollTop = c.scrollHeight;
}

// ── Reply : activer la barre de réponse ──────────────────────
function setReply(msgId, auteurNom, snippet) {
  replyState = { msgId, auteurNom, snippet };
  const preview = $("chat-reply-preview");
  const authorEl = $("chat-reply-author");
  const snippetEl = $("chat-reply-snippet");
  if (preview) preview.classList.add("active");
  if (authorEl) authorEl.textContent = auteurNom;
  if (snippetEl) snippetEl.textContent = snippet;
  $("chat-input")?.focus();
}

// ── Reply : annuler ───────────────────────────────────────────
function clearReply() {
  replyState = null;
  const preview = $("chat-reply-preview");
  if (preview) preview.classList.remove("active");
  const authorEl = $("chat-reply-author");
  const snippetEl = $("chat-reply-snippet");
  if (authorEl) authorEl.textContent = "";
  if (snippetEl) snippetEl.textContent = "";
}

// ── Bulle de message ──────────────────────────────────────────
function buildBubble(msgId, data) {


  const isMine = data.auteurUid === currentUser?.uid;
  const el = document.createElement("div");
  el.className = "chat-msg " + (isMine ? "chat-msg--mine" : "chat-msg--theirs");
  el.setAttribute("data-id", msgId);

  const timeStr = formatDate(data.timestamp || new Date(), "time");
  const deleteBtnHtml = (currentUser && isMine && !data.isDeleted)
    ? '<button class="chat-delete-btn" data-action="delete" aria-label="Supprimer">'
    + '<span class="material-symbols-outlined" style="font-size:1.05rem">delete</span></button>'
    : "";

  // ── Citation de réponse (si replyTo présent) ──
  let replyQuoteHtml = "";
  if (data.replyTo && !data.isDeleted) {
    replyQuoteHtml = `<span class="chat-bubble__reply-quote" data-reply-target="${esc(data.replyTo.msgId || '')}">
      <span class="chat-bubble__reply-quote--author">${esc(data.replyTo.auteurNom || "Élève")}</span>
      <span class="chat-bubble__reply-quote--text">${esc(data.replyTo.snippet || "")}</span>
    </span>`;
  }

  let inner = "";
  if (data.isDeleted === true) {
    inner = '<p class="chat-bubble__text" style="font-style:italic;opacity:.65">Ce message a été supprimé</p>';
  } else if (data.fileUrl) {
    const col = isMine ? "#064E3B" : "#fff";
    const icon = (data.fileName || "").toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "description";
    inner = replyQuoteHtml
      + '<div class="chat-file-attach" style="display:flex;align-items:center;gap:8px;'
      + 'background:rgba(255,255,255,.15);padding:8px 12px;border-radius:10px;'
      + 'border:1.5px solid rgba(255,255,255,.25);margin-bottom:2px">'
      + '<span class="material-symbols-outlined" style="font-size:1.35rem;color:' + col
      + ';font-variation-settings:\'FILL\' 1">' + icon + '</span>'
      + '<a href="' + esc(data.fileUrl) + '" target="_blank" rel="noopener" style="color:'
      + col + ';font-family:var(--font-label);font-size:.82rem;font-weight:700;'
      + 'text-decoration:underline;word-break:break-all">'
      + esc(data.fileName || "Document.pdf") + "</a></div>";
  } else if (data.imageUrl) {
    inner = replyQuoteHtml
      + '<a href="' + esc(data.imageUrl) + '" target="_blank" rel="noopener" class="chat-img-link">'
      + '<img src="' + esc(data.imageUrl) + '" alt="Image" class="chat-img-thumb" loading="lazy"/></a>';
  } else {
    inner = replyQuoteHtml + '<p class="chat-bubble__text">' + linkify(data.texte ?? "") + "</p>";
  }

  const timeHtml = '<div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:3px">'
    + '<span class="chat-bubble__time" style="font-size:.65rem;font-weight:600">' + esc(timeStr) + "</span>"
    + deleteBtnHtml + "</div>";

  if (isMine) {
    const bColor = data.bubbleColor || "#10B981";
    el.innerHTML = '<div class="chat-bubble chat-bubble--mine" style="background:' + bColor + '">' + inner + timeHtml + "</div>";
  } else {
    const color = avatarColor(data.auteurUid);
    const bColor = data.bubbleColor || color;
    const lletresInicials = initials(data.auteurNom || "Élève");

    // Colonne texte + bulle
    el.innerHTML = '<div class="chat-bubble__column">'
      + '<span class="chat-bubble__author">' + esc(data.auteurNom || "Élève") + "</span>"
      + '<div class="chat-bubble" style="background:' + bColor + '">'
      + inner + timeHtml + "</div></div>";

    const currentAvatarUrl = data.avatarUrl;

    // Avatar en DOM pur — évite les onerror inline dangereux
    if (currentAvatarUrl) {
      const imgEl = document.createElement("img");
      imgEl.src = currentAvatarUrl;
      imgEl.className = "chat-avatar";
      imgEl.alt = "Avatar";
      imgEl.style.objectFit = "cover";
      imgEl.addEventListener("error", function () {
        const span = document.createElement("span");
        span.className = "chat-avatar";
        span.style.background = color;
        span.textContent = lletresInicials;
        this.replaceWith(span);
      });
      el.insertBefore(imgEl, el.firstChild);
    } else {
      const span = document.createElement("span");
      span.className = "chat-avatar";
      span.style.background = color;
      span.textContent = lletresInicials;
      el.insertBefore(span, el.firstChild);
    }
  }

  // ── Clic sur la bulle → initier une réponse ──
  if (currentUser && !data.isDeleted) {
    const bubble = el.querySelector(".chat-bubble");
    if (bubble) {
      bubble.style.cursor = "pointer";
      bubble.addEventListener("click", (e) => {
        // Ignorer le clic sur les boutons internes
        if (e.target.closest('[data-action="delete"]') || e.target.tagName === "A") return;
        const snippet = data.imageUrl
            ? "📷 Image"
            : data.fileUrl
              ? "📎 " + (data.fileName || "Document")
              : (data.texte || "").substring(0, 60) + ((data.texte || "").length > 60 ? "…" : "");
        setReply(msgId, data.auteurNom || "Élève", snippet);
      });
    }
  }

  // ── Clic sur la citation → scroll vers le message original ──
  const quoteEl = el.querySelector(".chat-bubble__reply-quote");
  if (quoteEl) {
    quoteEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = quoteEl.getAttribute("data-reply-target");
      if (targetId) {
        const target = document.querySelector(`[data-id="${targetId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.style.outline = "2px solid var(--color-primary)";
          setTimeout(() => { target.style.outline = ""; }, 1500);
        }
      }
    });
  }

  // ── Suppression logique ──
  if (currentUser && isMine && !data.isDeleted) {
    el.querySelector('[data-action="delete"]')?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Voulez-vous vraiment supprimer ce message ?")) {
        try {
          await updateDoc(doc(db, "chat_messages", msgId), {
            texte: "Ce message a été supprimé", isDeleted: true,
          });
          toast("✅ Message supprimé !");
        } catch { toast("❌ Erreur de suppression"); }
      }
    });
  }
  return el;
}

// ── Listener temps réel ───────────────────────────────────────
function startListening() {
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }

  const container = $("chat-messages");
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<div class="chat-empty"><p>🔒 Connecte-toi pour voir les messages.</p></div>';
    return;
  }

  container.innerHTML = '<div class="chat-loading">Chargement…</div>';

  const q = query(
    collection(db, "chat_messages"),
    orderBy("timestamp", "desc"),
    limit(300)
  );

  unsubscribeChat = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      // Ignorer les pending writes locaux (évite le flash à l'envoi)
      if (snapshot.metadata.hasPendingWrites) return;

      container.innerHTML = "";
      if (snapshot.empty) {
        container.innerHTML = '<div class="chat-empty"><p>Aucun message. Lance la discussion ! 👋</p></div>';
        return;
      }

      const docs = [...snapshot.docs].reverse(); // DESC → ASC
      let lastDateStr = null;
      docs.forEach((docSnap) => {
        const data = docSnap.data();
        const dateStr = formatDate(data.timestamp || new Date(), "chat-date");
        if (dateStr && dateStr !== lastDateStr) {
          const div = document.createElement("div");
          div.className = "chat-date-divider";
          div.innerHTML = "<span>" + dateStr + "</span>";
          container.appendChild(div);
          lastDateStr = dateStr;
        }
        container.appendChild(buildBubble(docSnap.id, data));
      });
      scrollToBottom();
      setTimeout(scrollToBottom, 80);
    },
    (error) => {
      console.error("[chat] onSnapshot:", error.code, error.message);
      container.innerHTML = '<div class="chat-empty"><p>⚠️ Erreur : ' + esc(error.code) + "</p></div>";
    }
  );
}

// ── Envoi texte ───────────────────────────────────────────────
window.sendChatMessage = sendMessage;

async function sendMessage() {
  const input = $("chat-input");
  const sendBtn = $("chat-send-btn");
  const text = input?.value.trim();

  if (!text) return;

  const user = auth.currentUser;
  if (!user) { toast("🔒 Connecte-toi d'abord !"); return; }

  if (sendBtn) sendBtn.disabled = true;
  input.value = "";

  const auteurNom = user.displayName || user.email?.split("@")[0] || "Élève";
  const bubbleColor = localStorage.getItem("fermat-bubble-color") || "#10B981";

  // Capture et efface le replyState avant l'envoi
  const currentReply = replyState ? { ...replyState } : null;
  clearReply();

  try {
    const timerP = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000));
    const payload = {
      texte: text,
      auteurUid: user.uid,
      auteurNom,
      avatarUrl: user.photoURL || null,
      bubbleColor,
      timestamp: serverTimestamp(),
    };
    // Ajouter replyTo seulement si l'utilisateur répond à un message
    if (currentReply) {
      payload.replyTo = {
        msgId: currentReply.msgId,
        auteurNom: currentReply.auteurNom,
        snippet: currentReply.snippet,
      };
    }

    const writeP = addDoc(collection(db, "chat_messages"), payload);
    writeP.catch(e => console.warn("Background write échoué:", e));
    const docRef = await Promise.race([writeP, timerP]);

    // UI optimiste
    const container = $("chat-messages");
    if (container) {
      const fakeTs = { toDate: () => new Date() };
      const bubble = buildBubble(docRef.id, {
        ...payload,
        timestamp: fakeTs,
        isDeleted: false,
      });
      container.querySelector('[data-id="' + docRef.id + '"]')?.remove();
      container.appendChild(bubble);
      scrollToBottom();
    }
    toast("✅ Message envoyé !");

  } catch (err) {
    console.error("[chat] sendMessage:", err.code ?? err.message);
    input.value = text;
    if (err.message === "timeout") {
      window.forceResetFirestoreNetwork?.();
      toast("⏱️ Réseau bloqué — réinitialisation en cours… Réessaie dans 3s", 5000);
    } else if (err.code === "permission-denied") {
      toast("❌ Permission refusée par Firestore", 5000);
    } else {
      toast("❌ Erreur : " + (err.code || err.message), 5000);
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Envoi image ImgBB ─────────────────────────────────────────────
async function sendImage(file) {
  const user = auth.currentUser;
  if (!user || !file) return;
  const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
  if (!isImage || file.size > 20 * 1024 * 1024) { 
      toast("⚠️ Fichier trop lourd (max 20 Mo) ou format non supporté."); 
      return; 
  }
  const auteurNom = user.displayName || user.email?.split("@")[0] || "Élève";
  toast("⏳ Envoi de l'image…");
  try {
    const base64DataUrl = await compressImageToBase64(file, 1200, 1200, 0.82);
    const base64 = base64DataUrl.split(",")[1];
    const fd = new FormData();
    fd.append("key", IMGBB_API_KEY);
    fd.append("image", base64);
    const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error("ImgBB HTTP " + res.status);
    const result = await res.json();
    if (!result.success) throw new Error("ImgBB error");
    const bubbleColor = localStorage.getItem("fermat-bubble-color") || "#10B981";
    await addDoc(collection(db, "chat_messages"), {
      texte: "📷 Image", imageUrl: result.data.display_url,
      auteurUid: user.uid, auteurNom,
      avatarUrl: user.photoURL || null, bubbleColor, timestamp: serverTimestamp(),
    }).catch(console.error);
    toast("✅ Image envoyée !");
  } catch (err) {
    console.error(err);
    toast("❌ Échec de l'envoi de l'image. Privilégiez un lien Google Drive si le problème persiste.");
  }
}

// ── Envoi document (Firebase Storage désactivé) ───────────────
async function sendDocument() {
  toast("❌ L'envoi de documents n'est pas disponible (stockage désactivé).");
}


// ── Connexion des événements DOM ──────────────────────────────
function wireEvents() {
  if (isInitialized) return;
  isInitialized = true;

  // Envoi texte
  $("chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Pièce jointe
  $("chat-attach-btn")?.addEventListener("click", () => $("chat-file-input")?.click());
  $("chat-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
      if (!isImage || file.size > 20 * 1024 * 1024) { 
          toast("⚠️ Fichier trop lourd (max 20 Mo) ou format non supporté."); 
          return; 
      }
      sendImage(file);
    }
    e.target.value = "";
  });

  // Annuler la réponse
  $("chat-reply-cancel")?.addEventListener("click", clearReply);

}

// ── API publique ──────────────────────────────────────────────
export function initChat() {
  wireEvents();



  if (unsubscribeAuth) unsubscribeAuth();
  currentUser = null;
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    startListening();
  });
}

export function destroyChat() {
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }

  clearReply();
  isInitialized = false;
}
