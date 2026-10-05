// ================================================================
//  profil.js — Composant Profil & Personnalisation
//  Lycée Skillforge · Hub de Classe
//  ----------------------------------------------------------------
//  • Affiche l'identité Firebase Auth
//  • Avatar grand format + badge crayon + modal de sélection
//  • Sélecteur d'accent (Vert / Bleu / Orange) → CSS var
//  • Toggle Dark Mode → data-theme sur <html>
//  • Persistance localStorage
//  • Sign out Firebase Auth
//  • Annuaire étudiants + actions admin (délégué)
//  • Toggle fermeture des inscriptions (délégué)
// ================================================================

import { auth, db } from "./firebase.js";
import { toast, initials, avatarColor, esc, compressImageToBase64 } from "./utils.js";
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  onSnapshot,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";


// ----------------------------------------------------------------
//  CONSTANTES
// ----------------------------------------------------------------

const ACCENT_KEY   = "fermat-accent";
const DARKMODE_KEY = "fermat-dark";
const AVATAR_KEY   = "fermat-avatar";

/** Classe fixée pour ce groupe — ne pas modifier */
const CLASSE = "Première";

// ----------------------------------------------------------------
//  ÉTAT
// ----------------------------------------------------------------
let currentUser     = null;
let currentAvatar   = null;
let unsubscribeAuth = null;   // FIX: stocker pour cleanup
let controlsWired   = false;  // FIX: prévenir le double-binding
let unsubscribeDirectory = null;

// ── Cropper state ──
const cropState = { img: null, scale: 1, ox: 0, oy: 0, dragging: false, lastX: 0, lastY: 0 };

// ── État annuaire ──
const DIRECTORY_CACHE_KEY = "fermat-directory-cache";
const DIRECTORY_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 heures
let currentStudentForModal = null; // données de l'étudiant sélectionné
let isDelegue = false;             // rôle du user connecté

// ----------------------------------------------------------------
//  RÉFÉRENCES DOM (montées après le module chargé)
// ----------------------------------------------------------------
const getEl = (id) => document.getElementById(id);

// ----------------------------------------------------------------
//  IMAGE CROPPER (canvas maison)
// ----------------------------------------------------------------

function initCropper(file) {
  const canvas = getEl("avatar-crop-canvas");
  if (!canvas) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    cropState.img   = img;
    cropState.scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    cropState.ox    = (canvas.width  - img.width  * cropState.scale) / 2;
    cropState.oy    = (canvas.height - img.height * cropState.scale) / 2;
    drawCropper();
    wireCropperEvents(canvas);
  };
  img.src = url;
}

function drawCropper() {
  const canvas = getEl("avatar-crop-canvas");
  if (!canvas || !cropState.img) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    cropState.img,
    cropState.ox, cropState.oy,
    cropState.img.width  * cropState.scale,
    cropState.img.height * cropState.scale
  );
}

function getCroppedBlob() {
  const canvas = getEl("avatar-crop-canvas");
  if (!canvas || !cropState.img) return Promise.resolve(null);
  // Crée un canvas carré 300×300
  const out = document.createElement("canvas");
  out.width = out.height = 300;
  const ctx = out.getContext("2d");
  // Calcul du ratio source/dest
  const ratio = 300 / canvas.width;
  ctx.drawImage(
    cropState.img,
    cropState.ox * ratio, cropState.oy * ratio,
    cropState.img.width  * cropState.scale * ratio,
    cropState.img.height * cropState.scale * ratio
  );
  return new Promise(resolve => out.toBlob(resolve, "image/jpeg", 0.88));
}

let _cropperWired = false;
function wireCropperEvents(canvas) {
  if (_cropperWired) return;
  _cropperWired = true;
  
  // Gestion Souris (Desktop)
  canvas.addEventListener("mousedown",  e => { cropState.dragging = true; cropState.lastX = e.clientX; cropState.lastY = e.clientY; });
  canvas.addEventListener("mousemove",  e => {
    if (!cropState.dragging) return;
    cropState.ox += e.clientX - cropState.lastX;
    cropState.oy += e.clientY - cropState.lastY;
    cropState.lastX = e.clientX; cropState.lastY = e.clientY;
    drawCropper();
  });
  canvas.addEventListener("mouseup",   () => { cropState.dragging = false; });
  canvas.addEventListener("mouseleave",() => { cropState.dragging = false; });
  
  // Gestion Tactile (Mobile)
  canvas.addEventListener("touchstart", e => { e.preventDefault(); const t = e.touches[0]; cropState.dragging = true; cropState.lastX = t.clientX; cropState.lastY = t.clientY; }, { passive: false });
  canvas.addEventListener("touchmove",  e => {
    e.preventDefault();
    if (!cropState.dragging) return;
    const t = e.touches[0];
    cropState.ox += t.clientX - cropState.lastX;
    cropState.oy += t.clientY - cropState.lastY;
    cropState.lastX = t.clientX; cropState.lastY = t.clientY;
    drawCropper();
  }, { passive: false });
  canvas.addEventListener("touchend",  () => { cropState.dragging = false; });
}

// ----------------------------------------------------------------
//  PRÉFÉRENCES — ACCENT COLOR
// ----------------------------------------------------------------

/**
 * Applique la couleur d'accent sur toute l'app via CSS variables.
 * Mise à jour complète de la palette (primaire, secondaire, tertiaire).
 */
export function applyAccent(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) hex = "#10B981";

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  // En mode sombre : éclaircir le couleur choisie pour garantir la lisibilité
  let displayHex = hex;
  if (isDark) {
    const ri = parseInt(hex.slice(1, 3), 16);
    const gi = parseInt(hex.slice(3, 5), 16);
    const bi = parseInt(hex.slice(5, 7), 16);
    // Mélange vers blanc : 60% original + 40% blanc
    const lighten = (v) => Math.min(255, Math.round(v + (255 - v) * 0.5)).toString(16).padStart(2, "0");
    displayHex = "#" + lighten(ri) + lighten(gi) + lighten(bi);
  }

  // Calcul de la luminance relative pour déterminer la couleur du texte
  const r = parseInt(displayHex.slice(1, 3), 16) / 255;
  const g = parseInt(displayHex.slice(3, 5), 16) / 255;
  const b = parseInt(displayHex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onPrimary = lum > 0.35 ? "#1a1a1a" : "#ffffff";

  // Dérive une version assombrie pour les containers
  const dk = (v) => Math.max(0, Math.round(v * 0.6)).toString(16).padStart(2, "0");
  const containerHex = "#" + dk(parseInt(displayHex.slice(1, 3), 16))
                           + dk(parseInt(displayHex.slice(3, 5), 16))
                           + dk(parseInt(displayHex.slice(5, 7), 16));

  document.documentElement.style.setProperty("--color-primary", displayHex);
  document.documentElement.style.setProperty("--color-primary-container", containerHex);
  document.documentElement.style.setProperty("--color-on-primary", onPrimary);
  document.documentElement.style.setProperty("--color-on-primary-container", "#ffffff");

  localStorage.setItem(ACCENT_KEY, hex); // Guardamos el color original (no el aclarado)

  // Synchronise le picker s'il est dans le DOM
  const picker = document.getElementById("profil-accent-input");
  if (picker) picker.value = hex;
}

/** Applique à partir du localStorage (appelé au démarrage de l'app) */
export function restoreAccent() {
  const saved = localStorage.getItem(ACCENT_KEY);
  if (saved) applyAccent(saved);
}

// ----------------------------------------------------------------
//  PRÉFÉRENCES — DARK MODE
// ----------------------------------------------------------------

export function applyDarkMode(enabled) {
  document.documentElement.setAttribute("data-theme", enabled ? "dark" : "light");
  localStorage.setItem(DARKMODE_KEY, enabled ? "1" : "0");

  // Met à jour le toggle s'il est dans le DOM
  const toggle = getEl("toggle-dark-mode");
  if (toggle) toggle.checked = enabled;

  // Icône dans la top bar
  const icon = getEl("dark-mode-icon");
  if (icon) icon.textContent = enabled ? "light_mode" : "dark_mode";

  // Réappliquer l'accent après changement de mode pour que les couleurs soient correctes
  const savedAccent = localStorage.getItem(ACCENT_KEY);
  if (savedAccent) applyAccent(savedAccent);
}

export function restoreDarkMode() {
  const saved = localStorage.getItem(DARKMODE_KEY);
  applyDarkMode(saved === "1");
}

// ----------------------------------------------------------------
//  AVATAR — Logique d'affichage
// ----------------------------------------------------------------

/**
 * Renvoie le HTML d'un avatar (img ou span initiales)
 * selon l'objet avatar stocké + taille.
 */
function renderAvatarEl(avatar, size = "lg") {
  const wrapClass = `profil-avatar profil-avatar--${size}`;

  if (avatar?.type === "url" && avatar.url) {
    return `<img class="${wrapClass}" src="${avatar.url}"
                 alt="Avatar" style="object-fit:cover;"
                 onerror="this.style.display='none'" />`;
  }

  const initVal  = avatar?.initials ?? "?";
  const bg       = avatar?.color ?? "#10B981";
  return `<span class="${wrapClass}" style="background:${bg};border-color:${bg};">${initVal}</span>`;
}

/** Charge l'avatar depuis localStorage et retourne l'objet */
function loadAvatar() {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Sauvegarde l'avatar */
function saveAvatar(avatar) {
  currentAvatar = avatar;
  localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
}

/** Met à jour tous les affichages d'avatar dans l'app */
function broadcastAvatar(avatar) {
  // Top bar avatar
  const topbar = getEl("btn-profile-avatar");
  if (topbar) topbar.innerHTML = renderAvatarEl(avatar, "sm");

  // Profil hero
  const heroWrap = getEl("profil-avatar-slot");
  if (heroWrap) heroWrap.innerHTML = renderAvatarEl(avatar, "lg");
}

// ----------------------------------------------------------------
//  MODAL AVATAR
// ----------------------------------------------------------------

function openAvatarModal() {
  document.body.style.overflow = "hidden";
  const modal = getEl("modal-avatar");
  if (!modal) return;

  // Pré-sélectionne l'avatar actif
  modal.querySelectorAll(".avatar-preset").forEach((btn) => {
    const isCurrent = currentAvatar?.id === btn.dataset.id;
    btn.classList.toggle("avatar-preset--active", isCurrent);
    btn.setAttribute("aria-pressed", isCurrent ? "true" : "false");
  });

  // Réinitialise
  const fileInput = getEl("avatar-file-input");
  const previewWrap = getEl("avatar-preview-wrap");
  const cropWrap = getEl("avatar-crop-wrap");
  if (fileInput)    fileInput.value = "";
  if (previewWrap)  previewWrap.style.display = "none";
  if (cropWrap)     cropWrap.style.display = "none";
  cropState.img = null;
  window._profileSelectedFile = null;

  modal.classList.add("open");
}

function closeAvatarModal() {
  document.body.style.overflow = "";
  getEl("modal-avatar")?.classList.remove("open");
}

// ----------------------------------------------------------------
//  RENDU DU PROFIL
// ----------------------------------------------------------------

function renderProfilePanel(user) {
  if (!user) return;

  // Nom affiché : displayName > email > "Elève de Première"
  const name = user.displayName
    || user.email?.split("@")[0]?.replace(/[._]/g, " ")
    || "Élève de Première";
  const el = (id) => getEl(id);

  if (el("profil-name"))        el("profil-name").textContent     = name;
  if (el("profil-email"))       el("profil-email").textContent    = user.email ?? "—";
  if (el("profil-uid-display")) el("profil-uid-display").textContent = user.uid ?? "—";
  if (el("profil-uid-short"))   el("profil-uid-short").textContent   = (user.uid?.substring(0, 8) ?? "—") + "…";

  // Prérempli le champ nom éditable
  const nomInput = el("profil-nom-input");
  if (nomInput && !nomInput._dirty) nomInput.value = user.displayName || "";

  // Avatar
  let avatar = null;
  if (user.photoURL) {
    avatar = { type: "url", url: user.photoURL };
  } else {
    avatar = loadAvatar() ?? {
      type:     "initials",
      initials: initials(name),
      color:    avatarColor(user.uid),
      id:       null,
    };
  }
  currentAvatar = avatar;
  broadcastAvatar(avatar);

  // Panels
  const authPanel  = getEl("auth-panel");
  const userPanel  = getEl("user-panel");
  if (authPanel) authPanel.hidden = true;
  if (userPanel) userPanel.hidden = false;
}

function renderAuthPanel() {
  const authPanel = getEl("auth-panel");
  const userPanel = getEl("user-panel");
  if (authPanel) authPanel.hidden = false;
  if (userPanel) userPanel.hidden = true;
}

// ----------------------------------------------------------------
//  CÂBLAGE DES CONTRÔLES
// ----------------------------------------------------------------

function wireControls() {
  // FIX: ne câble qu'une seule fois
  if (controlsWired) return;
  controlsWired = true;
  // ── Avatar ──
  getEl("profil-avatar-btn")?.addEventListener("click", openAvatarModal);
  getEl("profil-avatar-slot")?.addEventListener("click", openAvatarModal);
  getEl("btn-cancel-avatar")?.addEventListener("click", closeAvatarModal);
  getEl("modal-avatar")?.addEventListener("click", (e) => {
    if (e.target === getEl("modal-avatar")) closeAvatarModal();
  });

  // Presets
  document.querySelectorAll(".avatar-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".avatar-preset").forEach(b => {
        b.classList.remove("avatar-preset--active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("avatar-preset--active");
      btn.setAttribute("aria-pressed", "true");
      // Réinitialise le sélecteur de fichier si un preset est sélectionné
      const fileInput = getEl("avatar-file-input");
      const previewWrap = getEl("avatar-preview-wrap");
      if (fileInput)   fileInput.value = "";
      if (previewWrap) previewWrap.style.display = "none";
      window._profileSelectedFile = null;
    });
  });

  // ── Sélecteur de fichier ──
  getEl("avatar-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewWrap = getEl("avatar-preview-wrap");
    const cropWrap    = getEl("avatar-crop-wrap");
    const canvas      = getEl("avatar-crop-canvas");

    // Désélectionne les presets
    document.querySelectorAll(".avatar-preset").forEach(b => {
      b.classList.remove("avatar-preset--active");
      b.setAttribute("aria-pressed", "false");
    });

    if (canvas && cropWrap) {
      if (previewWrap) previewWrap.style.display = "none";
      cropWrap.style.display    = "block";
      initCropper(file);
    } else {
      if (cropWrap) cropWrap.style.display = "none";
      if (previewWrap) previewWrap.style.display = "flex";
      
      const previewImg = getEl("avatar-preview");
      if (previewImg) previewImg.src = URL.createObjectURL(file);
      
      const uploadName = getEl("avatar-upload-name");
      if (uploadName) uploadName.textContent = file.name;

      window._profileSelectedFile = file;
    }
  });

  // Confirmation du choix
  getEl("btn-confirm-avatar")?.addEventListener("click", async () => {
    if (cropState.img && currentUser) {
      const blob = await getCroppedBlob();
      if (blob) {
        await uploadAvatarFile(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
        return;
      }
    } else if (window._profileSelectedFile && currentUser) {
      await uploadAvatarFile(window._profileSelectedFile);
      window._profileSelectedFile = null;
      return;
    }
    const activeBtn = document.querySelector(".avatar-preset--active");
    if (!activeBtn) { closeAvatarModal(); return; }
    const avatar = {
      type:     "initials",
      id:       activeBtn.dataset.id,
      initials: activeBtn.dataset.initials,
      color:    activeBtn.dataset.color,
      name:     activeBtn.dataset.name,
    };
    saveAvatar(avatar);
    broadcastAvatar(avatar);
    closeAvatarModal();

    if (currentUser) {
      updateProfile(currentUser, { photoURL: "" }).catch(console.error);
      setDoc(doc(db, "utilisateurs", currentUser.uid), { avatarUrl: null, avatarPreset: { initials: activeBtn.dataset.initials, color: activeBtn.dataset.color } }, { merge: true }).catch(console.error);
    }
    toast("✅ Avatar mis à jour !");
  });

  // Boutons zoom cropper
  getEl("btn-crop-zoomin")?.addEventListener("click",  () => { cropState.scale = Math.min(cropState.scale + 0.15, 4); drawCropper(); });
  getEl("btn-crop-zoomout")?.addEventListener("click", () => { cropState.scale = Math.max(cropState.scale - 0.15, 0.3); drawCropper(); });

  // ── Accent color picker (libre) ──
  const accentPicker = document.getElementById("profil-accent-input");
  if (accentPicker) {
    // Initialise avec la valeur sauvegardée
    accentPicker.value = localStorage.getItem(ACCENT_KEY) || "#10B981";
    accentPicker.addEventListener("input", (e) => applyAccent(e.target.value));
  }

  // ── Chat themes ──
  document.querySelectorAll(".profil-chat-theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.theme;
      localStorage.setItem("chat-theme", idx);
      document.querySelectorAll(".profil-chat-theme-btn").forEach(b => {
        b.classList.toggle("theme-active", b.dataset.theme === idx);
      });
      const names = ["Menthe", "Nuit", "Soleil"];
      toast(`🎨 Fond du chat : ${names[parseInt(idx, 10)]}`);
    });
  });

  // ── Dark mode toggle ──
  getEl("toggle-dark-mode")?.addEventListener("change", (e) => {
    applyDarkMode(e.target.checked);
  });

  // ── Nom complet ── enregistrement sur clic ou Entrée
  const nomInput  = getEl("profil-nom-input");
  const saveNomBtn = getEl("btn-save-nom");

  if (nomInput) {
    nomInput.addEventListener("input", () => { nomInput._dirty = true; });
    nomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveNomComplet(nomInput.value); }
    });
    nomInput.addEventListener("blur", () => { nomInput._dirty = false; });
  }
  saveNomBtn?.addEventListener("click", () => saveNomComplet(nomInput?.value ?? ""));

  // ── Sign out ──
  getEl("profil-signout")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      toast("👋 Déconnecté !");
    } catch (err) {
      console.error(err);
      toast("❌ Erreur de déconnexion");
    }
  });


}

// ----------------------------------------------------------------
//  SAUVEGARDE DU NOM COMPLET
// ----------------------------------------------------------------

/**
 * Met à jour le nom complet de l'élève :
 * - Firebase Auth displayName  → propagé automatiquement dans chat/forum/devoirs
 * - Firestore utilisateurs/{uid}.nomComplet
 * - Interface locale immédiate
 */
async function saveNomComplet(nom) {
  const nomPropre = (nom ?? "").trim();
  if (!currentUser) { toast("🔒 Connecte-toi d'abord !"); return; }
  if (!nomPropre)   { toast("⚠️ Saisis ton prénom et ton nom."); return; }

  const userDoc = await getDoc(doc(db, "utilisateurs", currentUser.uid));
  let count = 0;
  if (userDoc.exists()) {
    const data = userDoc.data();
    count = data.nomModificationsCount ?? (data.nomModifie ? 1 : 0);
  }
  if (count >= 2) {
    toast("⚠️ Tu as atteint la limite de 2 modifications de nom.");
    return;
  }

  const btn = getEl("btn-save-nom");
  if (btn) { btn.disabled = true; btn.querySelector("span").textContent = "hourglass_top"; }

  try {
    // 1. Firebase Auth
    await updateProfile(currentUser, { displayName: nomPropre });

    const newCount = count + 1;
    // 2. Firestore (collection utilisateurs)
    await setDoc(
      doc(db, "utilisateurs", currentUser.uid),
      { nomComplet: nomPropre, classe: CLASSE, nomModifie: true, nomModificationsCount: newCount },
      { merge: true }
    );

    // 3. Mise à jour locale de l'interface
    const nomInput = getEl("profil-nom-input");
    if (nomInput) { nomInput.value = nomPropre; nomInput._dirty = false; }
    if (getEl("profil-name")) getEl("profil-name").textContent = nomPropre;

    const msgEl = document.getElementById("nom-lock-msg");
    if (msgEl) {
      if (newCount === 1) {
        msgEl.textContent = "Attention : Il ne vous reste plus qu'1 seule modification de nom.";
        msgEl.style.color = "var(--color-warning)";
      } else if (newCount >= 2) {
        msgEl.textContent = "⚠️ Votre nom est définitivement verrouillé (2/2 modifications utilisées).";
        msgEl.style.color = "var(--color-error)";
        if (nomInput) nomInput.disabled = true;
        const saveBtn = document.getElementById("btn-save-nom");
        if (saveBtn) saveBtn.style.display = "none";
      }
    }

    toast("✅ Nom mis à jour !");

  } catch (err) {
    console.error("Erreur saveNomComplet :", err);
    toast("❌ Impossible d'enregistrer le nom.");
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "check"; }
  }
}

// ----------------------------------------------------------------
//  TÉLÉVERSEMENT D'AVATAR — Canvas + Base64 dans Firestore
//  (Pas de Firebase Storage requis — fonctionne sur le plan Spark gratuit)
// ----------------------------------------------------------------

async function uploadAvatarFile(file) {
  if (!currentUser || !file) return;

  const btn          = getEl("btn-confirm-avatar");
  const progressWrap = getEl("avatar-progress-wrap");
  const progressBar  = getEl("avatar-progress-bar");

  // Validation (5 Mo max avant compression)
  if (file.size > 5 * 1024 * 1024) {
    toast("❌ Image trop lourde (max 5 Mo)");
    return;
  }

  // Verrou UI
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined"
      style="animation:spin .7s linear infinite">progress_activity</span> Compression…`;
  }
  if (progressWrap) progressWrap.style.display = "block";
  if (progressBar)  progressBar.style.width = "20%";

  try {
    // ── Étape 1 : compression Canvas (150×150 max, JPEG 0.82) ──
    const base64DataUrl = await compressImageToBase64(file, 150, 150, 0.82);
    const base64 = base64DataUrl.split(",")[1];
    if (progressBar) progressBar.style.width = "40%";

    // ── Étape 2 : upload vers ImgBB ──
    const IMGBB_API_KEY = "f11ee06544b643038a4d1f7e4d823924";
    const form = new FormData();
    form.append("key", IMGBB_API_KEY);
    form.append("image", base64);

    const resp = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: form,
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message ?? "ImgBB error");

    const avatarUrl = json.data.display_url;
    if (progressBar) progressBar.style.width = "80%";

    // ── Étape 3 : maj Firebase Auth ──
    await updateProfile(currentUser, { photoURL: avatarUrl });
    await setDoc(doc(db, "utilisateurs", currentUser.uid), { avatarUrl: avatarUrl }, { merge: true });
    if (progressBar) progressBar.style.width = "100%";

    // ── Étape 4 : broadcast dans toute l'app ──
    const avatar = { type: "url", url: avatarUrl };
    saveAvatar(avatar);
    broadcastAvatar(avatar);

    closeAvatarModal();
    toast("✅ Photo de profil mise à jour !");

  } catch (err) {
    console.error("Erreur compression/sauvegarde avatar :", err);
    toast("❌ Erreur lors du traitement de l'image.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined">check</span> Choisir`;
    }
    if (progressWrap) progressWrap.style.display = "none";
    if (progressBar)  progressBar.style.width = "0%";
  }
}


// ----------------------------------------------------------------
//  ANNUAIRE ÉTUDIANTS — Cache localStorage (12h) + rendu
// ----------------------------------------------------------------

function renderDirectory() {
  const listEl = document.getElementById("student-directory-list");
  if (!listEl) return;
  listEl.innerHTML = '<div class="student-directory__loading">Chargement de l\'annuaire…</div>';
  if (unsubscribeDirectory) unsubscribeDirectory();
  unsubscribeDirectory = onSnapshot(query(collection(db, "utilisateurs"), orderBy("nomComplet", "asc")), (snap) => {
    listEl.innerHTML = "";
    if (snap.empty) {
      listEl.innerHTML = '<div class="student-directory__loading">Aucun élève inscrit pour l\'instant.</div>';
      return;
    }
    snap.docs.forEach(docSnap => {
      const s = { uid: docSnap.id, ...docSnap.data() };
      const name  = s.nomComplet || s.email || "Élève";
      const role  = s.role || "";
      const color = s.avatarPreset?.color || avatarColor(s.uid);
      const ini   = s.avatarPreset?.initials || initials(name);
      const avatarHtml = s.avatarUrl
        ? `<img class="student-directory__avatar" src="${esc(s.avatarUrl)}" alt="Avatar" style="object-fit:cover;" />`
        : `<div class="student-directory__avatar" style="background:${color}">${ini}</div>`;
      const item = document.createElement("div");
      item.className = "student-directory__item is-delegue-clickable";
      item.setAttribute("data-uid", s.uid);
      const roleBadge = role === "delegue" || role === "admin" ? `<span class="student-directory__role-badge">${role}</span>` : "";
      const actionBtn = (isDelegue && s.uid !== currentUser?.uid) ? `<button class="student-directory__delete-btn" data-uid="${s.uid}" aria-label="Actions admin" title="Bloquer ou supprimer"><span class="material-symbols-outlined" style="font-size:1rem">manage_accounts</span></button>` : "";
      item.innerHTML = `${avatarHtml}<span class="student-directory__name">${esc(name)}</span>${roleBadge}${actionBtn}`;
      if (s.uid !== currentUser?.uid) {
        item.addEventListener("click", (e) => { if (e.target.closest(".student-directory__delete-btn")) return; openStudentModal(s); });
        const adminBtn = item.querySelector(".student-directory__delete-btn");
        if (adminBtn) adminBtn.addEventListener("click", (e) => { e.stopPropagation(); openStudentModal(s); });
      }
      listEl.appendChild(item);
    });
  }, (err) => {
    console.error("[profil] renderDirectory:", err);
    listEl.innerHTML = '<div class="student-directory__loading">⚠️ Impossible de charger l\'annuaire.</div>';
  });
}

// ----------------------------------------------------------------
//  MODAL INFORMATIONS ÉTUDIANT (délégué)
// ----------------------------------------------------------------

function censorEmail(email) {
  if (!email) return "—";
  const parts = email.split("@");
  if (parts.length !== 2) return "—";
  const name = parts[0];
  const visible = name.substring(0, 4);
  return visible + "****@" + parts[1];
}

function openStudentModal(student) {
  document.body.style.overflow = "hidden";
  currentStudentForModal = student;
  const name  = student.nomComplet || student.email || "Élève";
  const color = avatarColor(student.uid);
  const ini   = initials(name);

  const avatarEl = document.getElementById("student-modal-avatar");
  const nameEl   = document.getElementById("student-modal-name");
  const nomEl    = document.getElementById("student-modal-nom");
  const uidEl    = document.getElementById("student-modal-uid");
  const emailEl  = document.getElementById("student-modal-email");

  if (avatarEl) { avatarEl.textContent = ini; avatarEl.style.background = color; }
  if (nameEl)   nameEl.textContent  = name;
  if (nomEl)    nomEl.textContent   = student.nomComplet || "—";
  if (uidEl)    uidEl.style.display = 'none';
  if (emailEl)  emailEl.textContent = censorEmail(student.email);

  const modal = document.getElementById("modal-student-detail");
  if (modal) modal.classList.add("open");

  const blockBtn = document.getElementById("btn-block-student");
  if (blockBtn) blockBtn.style.display = isDelegue ? "flex" : "none";
}

function closeStudentModal() {
  document.body.style.overflow = "";
  const modal = document.getElementById("modal-student-detail");
  if (modal) modal.classList.remove("open");
  currentStudentForModal = null;

}

// ----------------------------------------------------------------
//  ACTIONS ADMIN — Blocage et Suppression (délégué)
// ----------------------------------------------------------------

async function blockStudent(uid, name) {
  if (!uid || !currentUser || !isDelegue) return;
  if (confirm(`Voulez-vous vraiment expulser ${name} de la classe ? L'action sera affichée dans le chat.`)) {
    try {
      await setDoc(doc(db, "user_status", uid), { 
        blocked: true, 
        blockedBy: currentUser.displayName || "Un délégué", 
        blockedAt: serverTimestamp() 
      }, { merge: true });

      await addDoc(collection(db, "chat_messages"), {
        texte: "🚨 Le délégué " + (currentUser.displayName || "Un délégué") + " a expulsé " + name + " de la classe.",
        auteurUid: currentUser.uid,
        auteurNom: "Système",
        bubbleColor: "#EF4444",
        timestamp: serverTimestamp()
      });

      toast(`🚫 ${name} a été expulsé(e).`);
      closeStudentModal();
    } catch (err) {
      console.error(err);
      toast("❌ Erreur lors de l'expulsion.");
    }
  }
}

async function deleteStudent(uid, name) {
  if (!uid) return;
  if (!confirm(`⚠️ Supprimer "${name}" de l'annuaire ?\n\nCette action supprime le profil Firestore.\nLe compte Firebase Auth doit être supprimé manuellement depuis la Console Firebase.`)) return;
  try {
    // Supprimer le document utilisateurs/{uid}
    await deleteDoc(doc(db, "utilisateurs", uid));
    // Aussi bloquer le compte pour éviter toute ré-utilisation
    await setDoc(doc(db, "user_status", uid), {
      blocked: true,
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: currentUser?.uid || "unknown",
    }, { merge: true });
    toast(`✅ Profil de ${name} supprimé de l'annuaire.`);
    closeStudentModal();
    // Rafraîchir l'annuaire
    renderDirectory();
  } catch (err) {
    console.error("[profil] deleteStudent:", err);
    toast("❌ Erreur lors de la suppression.");
  }
}

// ----------------------------------------------------------------
//  CÂBLAGE MODAL STUDENT + REGISTRATION LOCK
// ----------------------------------------------------------------

let studentModalWired = false;

function wireStudentModal() {
  if (studentModalWired) return;
  studentModalWired = true;

  document.getElementById("btn-close-student-modal")?.addEventListener("click", closeStudentModal);
  document.getElementById("modal-student-detail")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-student-detail")) closeStudentModal();
  });

  document.getElementById("btn-block-student")?.addEventListener("click", () => {
    if (!currentStudentForModal) return;
    blockStudent(
      currentStudentForModal.uid,
      currentStudentForModal.nomComplet || currentStudentForModal.email || "Élève"
    );
  });

  document.getElementById("btn-delete-student")?.addEventListener("click", () => {
    if (!currentStudentForModal) return;
    deleteStudent(
      currentStudentForModal.uid,
      currentStudentForModal.nomComplet || currentStudentForModal.email || "Élève"
    );
  });
}

// Toggle Fermer les inscriptions (délégué seulement)

export function initProfil() {
  wireControls();
  wireStudentModal();

  // Synchronise les pastilles accent et le toggle dark
  const savedAccent = localStorage.getItem(ACCENT_KEY);
  if (savedAccent) {
    document.querySelectorAll(".profil-accent-swatch").forEach((sw) => {
      sw.classList.toggle("accent-active", sw.dataset.color === savedAccent);
      sw.setAttribute("aria-pressed", sw.dataset.color === savedAccent ? "true" : "false");
    });
  }
  const isDarkStored = localStorage.getItem(DARKMODE_KEY) === "1";
  const toggleDark = getEl("toggle-dark-mode");
  if (toggleDark) toggleDark.checked = isDarkStored;

  // Synchronise les boutons de thème du chat
  const savedChatTheme = localStorage.getItem("chat-theme") ?? "0";
  document.querySelectorAll(".profil-chat-theme-btn").forEach((btn) => {
    btn.classList.toggle("theme-active", btn.dataset.theme === savedChatTheme);
  });

  // FIX: cleanup avant re-souscription
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      renderProfilePanel(user);

      // Détecter le rôle depuis Firestore pour le toggle inscriptions + annuaire
      try {
        const userSnap = await getDoc(doc(db, "utilisateurs", user.uid));
        if (userSnap.exists()) {
          const role = userSnap.data().role || "";
          isDelegue = role === "delegue" || role === "admin";


          const count = userSnap.data().nomModificationsCount ?? (userSnap.data().nomModifie ? 1 : 0);
          const nomInput = document.getElementById("profil-nom-input");
          const saveBtn = document.getElementById("btn-save-nom");
          let msgEl = document.getElementById("nom-lock-msg");
          if (!msgEl && nomInput) {
            nomInput.parentElement.insertAdjacentHTML('afterend', '<p id="nom-lock-msg" style="font-size:0.75rem; font-weight:600; margin-top:0.35rem;"></p>');
            msgEl = document.getElementById("nom-lock-msg");
          }
          if (msgEl) {
            if (count === 0) {
              msgEl.textContent = "Information : Vous pouvez modifier votre nom encore 2 fois.";
              msgEl.style.color = "var(--color-text-dim)";
            } else if (count === 1) {
              msgEl.textContent = "Attention : Il ne vous reste plus qu'1 seule modification de nom.";
              msgEl.style.color = "var(--color-warning)";
            } else {
              msgEl.textContent = "⚠️ Votre nom est définitivement verrouillé (2/2 modifications utilisées).";
              msgEl.style.color = "var(--color-error)";
              if (nomInput) nomInput.disabled = true;
              if (saveBtn) saveBtn.style.display = "none";
            }
          }
        }
      } catch (err) {
        console.error("[profil] rôle:", err);
      }

      // Charger l'annuaire (avec cache localStorage 12h)
      renderDirectory();

    } else {
      renderAuthPanel();
      isDelegue = false;
    }
  });
}

export function destroyProfil() {
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  if (unsubscribeDirectory) { unsubscribeDirectory(); unsubscribeDirectory = null; }

}

