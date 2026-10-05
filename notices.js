// ================================================================
//  notices.js — Composant Notices du Lycée
//  Lycée Skillforge · Hub de Classe
//  FIX: onAuthStateChanged leak, lazy DOM refs, filter double-binding
// ================================================================

import { db, auth } from "./firebase.js";
import { esc, formatDate, toast, showSkeletons, showEmptyState, compressImageToBase64 } from "./utils.js";

import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// ----------------------------------------------------------------
//  ÉTAT LOCAL
// ----------------------------------------------------------------
let currentUser        = null;
let unsubscribeNotices = null;
let unsubscribeAuth    = null;   // FIX: stocké pour cleanup
let eventsWired        = false;  // FIX: câblage unique
let filtersWired       = false;  // FIX: filtres câblés une fois
let userNoticesMasquees = {};
let unsubscribeProfile = null;
let noticeSelectedFile = null;
let noticePreviewUrl = null;

// ----------------------------------------------------------------
//  RÉFÉRENCE DOM (lazy)
// ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------
//  CONFIG CATÉGORIES
// ----------------------------------------------------------------
const CAT_CONFIG = {
  "Administration": { icon: "admin_panel_settings", color: "#10B981" },
  "Vie Scolaire":   { icon: "school",               color: "#3B82F6" },
  "Examens":        { icon: "quiz",                 color: "#3B82F6" },
  "Événements":     { icon: "event",                color: "#10B981" },
  "Sport":          { icon: "sports",               color: "#10B981" },
  "Voyages":        { icon: "flight",               color: "#3B82F6" },
  "Urgent":         { icon: "campaign",             color: "#F97316" },
};
const DEFAULT_CAT = { icon: "campaign", color: "#3B82F6" };

// ----------------------------------------------------------------
//  CONSTRUCTION D'UNE CARTE NOTICE
// ----------------------------------------------------------------
function buildNoticeCard(id, data) {
  const isUrgent = !!data.urgent || !!data.prioritaire;
  const catName  = data.categorie || "Événements";
  const cat      = CAT_CONFIG[catName] || CAT_CONFIG["Événements"];
  const bgColor = data.customColor || cat.color;
  const icon     = isUrgent ? "campaign" : cat.icon;
  const dateStr  = formatDate(data.date || data.createdAt);
  const excerpt  = (data.corps ?? "").length > 90
    ? data.corps.substring(0, 90).trimEnd() + "…"
    : data.corps ?? "";

  // Bouton poubelle visible par tous les élèves connectés pour le ménage
  const deleteBtnHtml = currentUser 
    ? `<button class="notice-delete-btn" data-action="delete" aria-label="Supprimer" style="background:none; border:none; color:white; cursor:pointer; display:inline-flex; align-items:center; margin-left:auto;"><span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span></button>` 
    : "";

  const card = document.createElement("article");
  card.className = `notice-card${isUrgent ? " notice-card--urgent" : ""}`;
  card.setAttribute("data-id", id);
  card.setAttribute("style", `--notice-bg: ${bgColor}`);
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", esc(data.titre));

  card.innerHTML = `
    <div class="notice-card__icon" aria-hidden="true">
      <span class="material-symbols-outlined">${icon}</span>
    </div>
    <div class="notice-card__content">
      <div class="notice-card__meta">
        <span class="notice-badge">${esc(data.categorie ?? "Général")}</span>
        ${data.imageUrl ? '<span class="notice-badge" style="display:inline-flex; align-items:center; justify-content:center; padding:0.1rem 0.4rem; background:rgba(255,255,255,0.2);"><span class="material-symbols-outlined" style="font-size: 0.85rem;">photo_camera</span></span>' : ""}
        ${isUrgent ? '<span class="notice-badge notice-badge--urgent">⚠ URGENT</span>' : ""}
        ${deleteBtnHtml}
        <span class="notice-author" style="font-size:0.65rem; color:rgba(255,255,255,0.7); margin-left:auto;">par ${esc(data.auteurNom || "Administration")}</span>
        <span class="notice-date" style="margin-left:0.5rem">${esc(dateStr)}</span>
      </div>
      <h3 class="notice-title">${esc(data.titre)}</h3>
      <p class="notice-excerpt" aria-hidden="true">${esc(excerpt)}</p>
      <p class="notice-full-body" hidden>${esc(data.corps ?? "")}</p>
      ${data.corps && data.corps.length > 90
        ? `<button class="notice-read-more" aria-expanded="false">
             Lire la suite <span class="material-symbols-outlined">expand_more</span>
           </button>`
        : ""}
    </div>`;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".notice-read-more") || e.target.closest("[data-action='delete']")) return;
    openDetailModal(data, bgColor, icon);
  });

  // Écouteur de suppression global
  if (currentUser) {
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Voulez-vous masquer cette notice pour vous ?")) {
        try {
          await setDoc(doc(db, "utilisateurs", currentUser.uid), { noticesMasquees: { [id]: true } }, { merge: true }); card.remove();
          toast("✅ Notice masquée !");
        } catch (err) {
          console.error(err);
          toast("❌ Erreur de suppression");
        }
      }
    });
  }

  const readMoreBtn = card.querySelector(".notice-read-more");
  if (readMoreBtn) {
    readMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const expanded   = readMoreBtn.getAttribute("aria-expanded") === "true";
      const excerptEl  = card.querySelector(".notice-excerpt");
      const fullEl     = card.querySelector(".notice-full-body");
      if (expanded) {
        excerptEl.removeAttribute("hidden");
        fullEl.setAttribute("hidden", "");
        readMoreBtn.setAttribute("aria-expanded", "false");
        readMoreBtn.innerHTML = `Lire la suite <span class="material-symbols-outlined">expand_more</span>`;
        card.classList.remove("notice-card--expanded");
      } else {
        excerptEl.setAttribute("hidden", "");
        fullEl.removeAttribute("hidden");
        readMoreBtn.setAttribute("aria-expanded", "true");
        readMoreBtn.innerHTML = `Réduire <span class="material-symbols-outlined">expand_less</span>`;
        card.classList.add("notice-card--expanded");
      }
    });
  }

  return card;
}

// ----------------------------------------------------------------
//  MODAL DÉTAIL
// ----------------------------------------------------------------
function openDetailModal(data, bgColor, icon) {
  document.body.style.overflow = "hidden";
  const modalDetail = $("modal-notice-detail");
  if (!modalDetail) return;
  const isUrgent = !!data.prioritaire || !!data.urgent;
  const iconEl   = $("detail-modal-icon");
  if (iconEl) { iconEl.textContent = icon; iconEl.style.color = "white"; }
  const badgeEl = $("detail-modal-badge");
  if (badgeEl) badgeEl.textContent = data.categorie ?? "Général";
  const titreEl = $("detail-modal-titre");
  if (titreEl) titreEl.textContent = data.titre ?? "";
  const corpsEl = $("detail-modal-corps");
  if (corpsEl) corpsEl.textContent = data.corps ?? "";
  
  const imgEl = $("detail-modal-img");
  if (imgEl) {
    if (data.imageUrl) {
      imgEl.src = data.imageUrl;
      imgEl.style.display = "block";
    } else {
      imgEl.src = "";
      imgEl.style.display = "none";
    }
  }

  const dateEl  = $("detail-modal-date");
  if (dateEl)  dateEl.textContent  = formatDate(data.date || data.createdAt);
  const headerEl = $("detail-modal-header");
  if (headerEl) headerEl.style.background = bgColor;
  const urgentEl = $("detail-modal-urgent");
  if (urgentEl) urgentEl.hidden = !isUrgent;
  history.pushState({ modalOpen: true }, ""); 
  modalDetail.classList.add("open");
}

// ----------------------------------------------------------------
//  ÉCOUTE TEMPS RÉEL
// ----------------------------------------------------------------
function startListening() {
  if (unsubscribeNotices) unsubscribeNotices();

  const feed = $("notices-feed");
  if (!feed) return;

  showSkeletons(feed, 3, "notice-skeleton");

  const q = query(collection(db, "notices"), orderBy("date", "desc"), limit(40));

  unsubscribeNotices = onSnapshot(q,
    (snap) => {
      const feed = $("notices-feed");
      if (!feed) return;
      feed.innerHTML = "";
      if (snap.empty) {
        showEmptyState(feed, "campaign", "Aucune notice pour le moment.");
        return;
      }

      const docs = snap.docs
        .map(d => ({ id: d.id, data: d.data() }))
        .filter(d => !userNoticesMasquees[d.id])
        .sort((a, b) => {
          const aUrg = a.data.prioritaire || a.data.urgent;
          const bUrg = b.data.prioritaire || b.data.urgent;
          if (bUrg !== aUrg)
            return (bUrg ? 1 : 0) - (aUrg ? 1 : 0);
          return 0;
        });

      docs.forEach(({ id, data }) => feed.appendChild(buildNoticeCard(id, data)));
    },
    (err) => {
      console.error("Erreur Firestore notices :", err);
      const feed = $("notices-feed");
      showEmptyState(feed, "error", "Impossible de charger les notices.");
    }
  );
}

// ----------------------------------------------------------------
//  CÂBLAGE DES ÉVÉNEMENTS (une seule fois)
// ----------------------------------------------------------------
function wireEvents() {
  if (eventsWired) return;
  eventsWired = true;

  // Modal détail — fermeture
  $("btn-close-detail")?.addEventListener("click", () => {
    document.body.style.overflow = "";
    $("modal-notice-detail")?.classList.remove("open");
  });
  $("modal-notice-detail")?.addEventListener("click", (e) => {
    if (e.target === $("modal-notice-detail")) {
      document.body.style.overflow = "";
      $("modal-notice-detail").classList.remove("open");
    }
  });

  // FAB → modal nouvelle notice
  $("fab-new-notice")?.addEventListener("click", () => {
    document.body.style.overflow = "hidden";
    const modalNew    = $("modal-new-notice");
    const inputTitre  = $("notice-titre");
    const inputCorps  = $("notice-corps");
    const selectCat   = $("notice-categorie");
    const checkUrgent = $("notice-urgent");
    const btnSubmit   = $("btn-submit-notice");
    if (!modalNew) return;
    history.pushState({ modalOpen: true }, ""); 
    modalNew.classList.add("open");
    noticeSelectedFile = null;
    if (noticePreviewUrl) URL.revokeObjectURL(noticePreviewUrl);
    noticePreviewUrl = null;
    if ($("notice-image-preview-wrap")) $("notice-image-preview-wrap").style.display = "none";
    if ($("notice-preview-img")) $("notice-preview-img").src = "";
    inputTitre?.focus();
    if (inputTitre)   inputTitre.value    = "";
    if (inputCorps)   inputCorps.value    = "";
    if (selectCat)    selectCat.value     = "Administration";
    if (checkUrgent)  checkUrgent.checked = false;
    const colorPicker = $("notice-color-picker");
    if (colorPicker)  colorPicker.value   = "#10B981";  // Reset au défaut à chaque ouverture
    if (btnSubmit)   {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span class="material-symbols-outlined">send</span> Publier`;
    }
  });

  $("btn-cancel-notice")?.addEventListener("click", () => {
    document.body.style.overflow = "";
    $("modal-new-notice")?.classList.remove("open");
  });
  $("modal-new-notice")?.addEventListener("click", (e) => {
    if (e.target === $("modal-new-notice")) {
      document.body.style.overflow = "";
      $("modal-new-notice").classList.remove("open");
    }
  });

  $("notice-attach-btn")?.addEventListener("click", () => $("notice-file-input")?.click());
  $("notice-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
    if (!isImage || file.size > 20 * 1024 * 1024) { 
        toast("⚠️ Seules les images (max 20 Mo) sont autorisées."); 
        return; 
    }
    noticeSelectedFile = file;
    if (noticePreviewUrl) URL.revokeObjectURL(noticePreviewUrl);
    noticePreviewUrl = URL.createObjectURL(file);
    if ($("notice-preview-img")) $("notice-preview-img").src = noticePreviewUrl;
    if ($("notice-image-preview-wrap")) $("notice-image-preview-wrap").style.display = "block";
  });

  // Soumission de la notice
  $("btn-submit-notice")?.addEventListener("click", async () => {
    const titre       = $("notice-titre")?.value.trim();
    const corps       = $("notice-corps")?.value.trim();
    const cat         = $("notice-categorie")?.value;
    const urg         = $("notice-urgent")?.checked;
    const customColor = $("notice-color-picker")?.value || "#10B981";
    const btnSubmit   = $("btn-submit-notice");

    if (!titre) {
      if (typeof toast === "function") toast("⚠️ Le titre est obligatoire !");
      return;
    }

    if (!currentUser) {
      if (typeof toast === "function") toast("🔒 Connecte-toi pour publier une notice !");
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="material-symbols-outlined" style="animation:spin .7s linear infinite">progress_activity</span> Publication…`;
    }

try {
      let imageUrl = null;
      if (noticeSelectedFile) {
        if (typeof toast === "function") toast("⏳ Envoi de l'image...");
        const base64DataUrl = await compressImageToBase64(noticeSelectedFile, 1200, 1200, 0.82);
        const base64 = base64DataUrl.split(",")[1];
        const fd = new FormData(); fd.append("key", "f11ee06544b643038a4d1f7e4d823924"); fd.append("image", base64);
        const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.success) imageUrl = json.data.display_url;
      }

      await addDoc(collection(db, "notices"), {
        titre: titre,
        corps: corps,
        categorie: cat,
        urgent: urg,
        customColor: customColor,
        auteurUid: currentUser.uid,
        auteurNom: currentUser.displayName || currentUser.email.split("@")[0] || "Élève",
        imageUrl: imageUrl || null,
        date: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      $("modal-new-notice")?.classList.remove("open");
      if (typeof toast === "function") toast("📢 Notice publiée avec succès !");
    } catch (err) {
      console.error("Erreur publication notice:", err);
      if (typeof toast === "function") toast("❌ Erreur lors de la publication");
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span class="material-symbols-outlined">send</span> Publier`;
      }
    }
  });
}

// ----------------------------------------------------------------
//  EXPORTS
// ----------------------------------------------------------------
let popstateWiredNotices = false; // 👈 Variable de control nova
export function initNotices() {
  if (!popstateWiredNotices) {
    popstateWiredNotices = true;
    window.addEventListener("popstate", () => {
      $("modal-notice-detail")?.classList.remove("open");
      $("modal-new-notice")?.classList.remove("open");
    });
  }
  wireEvents();

  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeProfile = onSnapshot(doc(db, "utilisateurs", user.uid), (snap) => {
        userNoticesMasquees = snap.data()?.noticesMasquees || {};
        startListening();
      });
    } else {
      userNoticesMasquees = {};
      startListening();
    }
  });

  if (!filtersWired) {
    filtersWired = true;
    document.querySelectorAll(".notice-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".notice-filter-btn").forEach((b) => {
          b.classList.toggle("filter-btn--active",   b === btn);
          b.classList.toggle("filter-btn--inactive", b !== btn);
        });
        const filter = btn.dataset.filter;
        document.querySelectorAll(".notice-card").forEach((card) => {
          const isUrgent = card.classList.contains("notice-card--urgent");
          if (filter === "tous")   card.style.display = "";
          if (filter === "urgent") card.style.display = isUrgent  ? "" : "none";
          if (filter === "normal") card.style.display = !isUrgent ? "" : "none";
        });
      });
    });
  }
}

export function destroyNotices() {
  if (unsubscribeNotices) { unsubscribeNotices(); unsubscribeNotices = null; }
  if (unsubscribeAuth)    { unsubscribeAuth();    unsubscribeAuth    = null; }
  if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
}
