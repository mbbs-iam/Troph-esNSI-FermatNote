// ================================================================
//  utils.js — Utilitaires Partagés & Mutualisés
//  Lycée Skillforge · Hub de Classe
//  Clean, DRY & Scalable (Refactorisation de Nettoyage)
// ================================================================

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeUrl(url) {
  if (!url) return "";
  const clean = String(url).trim();
  if (clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("blob:")) {
    return esc(clean);
  }
  return "#";
}

export function toast(msg, dur = 2200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), dur);
}

export function initials(name) {
  const p = (name ?? "?").trim().split(" ");
  return p.length >= 2 
    ? (p[0][0] + p[1][0]).toUpperCase() 
    : (p[0] ?? "?").substring(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#2170e4", "#F97316", "#10b981", "#9d4300", "#0058be", "#006c49", "#8B5CF6", "#EC4899"];
export function avatarColor(uid) {
  let h = 0;
  for (let i = 0; i < (uid ?? "x").length; i++) h = uid.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function formatDate(timestamp, mode = "normal") {
  if (!timestamp) return mode === "deadline" ? { label: "Aujourd'hui", urgent: false } : (mode === "relative" ? "à l'instant" : "Aujourd'hui");
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d - today) / 86400000);

  if (mode === "deadline") {
    if (diff < 0)  return { label: "En retard !", urgent: true };
    if (diff === 0) return { label: "Aujourd'hui", urgent: true };
    if (diff === 1) return { label: "Demain", urgent: false };
    if (diff <= 3) return { label: `Dans ${diff} j.`, urgent: false };
    return { label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), urgent: false };
  }

  if (mode === "time") {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  // MÈTODE CORREGIT: Separadors cronològics dinàmics per a la línia temporal del xat de classe
  if (mode === "chat-date") {
    if (diff === 0) return "Aujourd'hui";
    if (diff === -1) return "Hier";
    if (diff === -2) return "Il y a 2 jours";
    if (diff > -7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  if (mode === "relative") {
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return "à l'instant";
    if (diffSec < 3600) return `il y a ${Math.floor(diffSec / 60)} min`;
    if (diffSec < 86400) return `il y a ${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 86400 * 7) return `il y a ${Math.floor(diffSec / 86400)} j`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  if (mode === "full") {
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  // normal (notices, courrier)
  if (diff === 0) return `Aujourd'hui · ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  if (diff === -1) return "Hier";
  if (diff > -7) return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function showSkeletons(feed, n, cls) {
  if (feed) feed.innerHTML = Array.from({ length: n })
    .map(() => `<div class="${cls}" aria-hidden="true"></div>`).join("");
}

export function showEmptyState(feed, icon, msg) {
  if (feed) feed.innerHTML = `
    <div class="empty-state">
      <span class="material-symbols-outlined">${icon}</span>
      <p>${msg}</p>
    </div>`;
}

// 📡 Indicador de connexió per a la PWA (Online/Offline)
window.addEventListener("offline", () => {
  toast("⚠️ Connexió perduda. Treballant en mode fora de línia.");
});

window.addEventListener("online", () => {
  toast("🟢 Connexió restablerta !");
});

export function linkify(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return esc(text).replace(urlRegex, function(url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="text-decoration:underline; font-weight:bold;">' + url + '</a>';
  });
}

/**
 * Compresse une image en base64 via un canvas HTML.
 * Évite les crashs RAM sur iOS en évitant FileReader + blob concurrent.
 * @param {File}   file    - le fichier image sélectionné
 * @param {number} maxW    - largeur max en pixels (défaut 150)
 * @param {number} maxH    - hauteur max en pixels (défaut 150)
 * @param {number} quality - qualité JPEG 0.0→1.0 (défaut 0.82)
 * @returns {Promise<string>} data URI base64
 */
export function compressImageToBase64(file, maxW = 150, maxH = 150, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image invalide")); };
    img.src = url;
  });
}
