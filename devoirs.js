// ================================================================
//  devoirs.js — Composant Devoirs + Évaluations
//  Lycée Skillforge · Hub de Classe
//  Clean, DRY & Scalable (Refactorisation de Nettoyage)
// ================================================================

import { db, auth } from "./firebase.js";
import { getMatiereColor, getMatiereIcon, buildMatiereOptions, getMatiereInfo } from "./matieres.js";
import { esc, toast, formatDate, showSkeletons } from "./utils.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

let currentUser = null;
let unsubscribeDevoirs = null;
let unsubscribeEvals = null;
let unsubscribeAuth = null;
let filtersWired = false;
let eventsWired = false;
let currentView = "devoirs";

let userDevoirsFaits = {};
let userDevoirsMasques = {}; // Deures que l'alumne ha esborrat per a ell
let userEvalsMasquees = {};  // Avaluacions que l'alumne ha esborrat per a ell
let unsubscribeFaits = null;
let devoirUploadedImageUrl = ""; // URL final de la imagen subida a ImgBB

// ESTAT GLOBAL NOU: Guarda els deures actius per a actualitzacions optimistes instantànies
let activeDevoirsList = [];

const $ = (id) => document.getElementById(id);

function updateStats(docs) {
  const total = docs.length;
  const faits = docs.filter(d => userDevoirsFaits[d.id] === true).length;
  const pct = total ? Math.round((faits / total) * 100) : 0;
  const sTotal = $("devoirs-stats-total");
  const sFaits = $("devoirs-stats-faits");
  const sBar = $("devoirs-progress-bar");
  if (sTotal) sTotal.textContent = total;
  if (sFaits) sFaits.textContent = faits;
  if (sBar) sBar.style.width = `${pct}%`;
}

async function toggleFait(devoirId, currentFait) {
  if (!currentUser) return;
  const newFait = !currentFait;
  // S'actualitza l'estat local immediatament
  userDevoirsFaits[devoirId] = newFait;
  try {
    await setDoc(doc(db, "utilisateurs", currentUser.uid), { devoirsFaits: { [devoirId]: newFait } }, { merge: true });
  } catch (err) {
    userDevoirsFaits[devoirId] = currentFait;
    console.error(err);
    toast("❌ Erreur de mise à jour");
  }
}

function buildDevoirCard(id, data) {
  const matShort = getMatiereInfo(data.matiere)?.short || data.matiere;
  const card = document.createElement("div");
  const icon = getMatiereIcon(data.matiere);
  const dl = formatDate(data.date_limite, "deadline");
  const fait = userDevoirsFaits[id] === true;
  const matColor = getMatiereColor(data.matiere);

  card.className = `devoir-card devoir-card--colored ${fait ? "devoir-card--done" : ""}`;
  card.setAttribute("data-id", id);
  card.style.setProperty("--matiere-color", matColor);

  card.innerHTML = `
    <label class="devoir-checkbox" aria-label="Marquer comme ${fait ? "non fait" : "fait"}">
      <input type="checkbox" ${fait ? "checked" : ""} class="devoir-checkbox__input" />
      <span class="devoir-checkbox__box">
        <span class="material-symbols-outlined">done</span>
      </span>
    </label>
    <div class="devoir-card__icon" aria-hidden="true">
      <span class="material-symbols-outlined">${icon}</span>
    </div>
    <div class="devoir-card__body">
      <span class="devoir-card__matiere">${esc(matShort)}</span>
      <p class="devoir-card__titre">${esc(data.titre)}</p>
      <span style="font-size:0.65rem; color:var(--color-on-surface-variant); opacity:0.8; display:block; margin-top:2px;">par ${esc(data.auteurNom || "Élève")}</span>
      ${data.imageUrl ? `
        <div class="devoir-card__img-wrap">
          <img class="devoir-card__img" src="${esc(data.imageUrl)}" alt="${esc(data.titre)}" loading="lazy" onerror="this.closest('.devoir-card__img-wrap').style.display='none'" />
        </div>` : ""}
    </div>
    <span class="devoir-deadline ${dl.urgent ? "devoir-deadline--urgent" : ""}">
      <span class="material-symbols-outlined">schedule</span>
      ${esc(dl.label)}
    </span>
    <button class="devoir-delete-btn" aria-label="Supprimer" style="background:none; border:none; color:white; cursor:pointer; margin-left:auto; display:flex; align-items:center;"><span class="material-symbols-outlined">delete</span></button>`;

  card.querySelector(".devoir-checkbox__input").addEventListener("change", (e) => {
    e.stopPropagation();
    const isChecked = e.target.checked;
    card.classList.toggle("devoir-card--done", isChecked);

    // CORRECCIÓ OPTIMISTA: Forcem el recàlcul de la barra instantàniament al DOM abans del viatge de xarxa
    userDevoirsFaits[id] = isChecked;
    updateStats(activeDevoirsList);

    toggleFait(id, !isChecked);
  });

  // Clic en la imagen → abre el lightbox
  card.querySelector(".devoir-card__img")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openLightbox(data.imageUrl);
  });

const deleteBtn = card.querySelector(".devoir-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Voulez-vous masquer ce devoir de votre agenda personnel ?")) {
        try {
          // 🛡️ ESBORRAT PERSONAL: S'amaga per a l'usuari actual
          userDevoirsMasques[id] = true;
          await setDoc(doc(db, "utilisateurs", currentUser.uid), { devoirsMasques: { [id]: true } }, { merge: true });
          
          card.remove(); // Eliminem la targeta de la pantalla immediatament
          
          // Actualitzem la barra de progrés
          activeDevoirsList = activeDevoirsList.filter(d => d.id !== id);
          updateStats(activeDevoirsList);
          
          toast("✅ Devoir masqué !");
        } catch (err) {
          console.error(err);
          toast("❌ Erreur");
        }
      }
    });
  }
  // Escuchador para expandir o contraer la tarjeta al hacer clic
  card.addEventListener("click", () => {
    card.classList.toggle("devoir-card--expanded");
  });
  return card;
}

function buildEvalCard(id, data) {
  const matShort = getMatiereInfo(data.matiere)?.short || data.matiere;
  const color = getMatiereColor(data.matiere);
  const icon = getMatiereIcon(data.matiere);
  const dateStr = formatDate(data.date, "full");
  const dl = formatDate(data.date, "deadline");

  const card = document.createElement("div");
  card.className = "eval-card";
  card.setAttribute("data-id", id);
  card.style.setProperty("--eval-color", color);

  card.innerHTML = `
    <div class="eval-card__stripe"></div>
    <div class="eval-card__main">
      <div class="eval-card__header">
        <div class="eval-card__matiere-wrap">
          <span class="eval-card__icon material-symbols-outlined">${icon}</span>
          <span class="eval-card__matiere">${esc(matShort)}</span>
        </div>
        <div class="eval-card__badges" style="align-items: center; gap: 0.375rem;">
          ${data.type ? `<span class="eval-type-badge">${esc(data.type)}</span>` : ""}
          ${data.coefficient ? `<span class="eval-coeff-badge">Coeff. ${esc(String(data.coefficient))}</span>` : ""}
          <button class="eval-delete-btn" aria-label="Supprimer" style="background:none; border:none; color:var(--color-primary); cursor:pointer; display:flex; align-items:center;"><span class="material-symbols-outlined">delete</span></button>
        </div>
      </div>
      <p class="eval-card__sujet">${esc(data.sujet ?? "Sujet non précisé")}</p>
      <span style="font-size:0.65rem; color:var(--color-on-surface-variant); opacity:0.8; display:block; margin-top:2px;">par ${esc(data.auteurNom || "Élève")}</span>
      <div class="eval-card__footer">
        <span class="eval-date ${dl.urgent ? "eval-date--urgent" : ""}">
          <span class="material-symbols-outlined">event</span>
          ${esc(dateStr)}
        </span>
        ${data.professeur ? `
        <span class="eval-prof">
          <span class="material-symbols-outlined">person</span>
          ${esc(data.professeur)}
        </span>` : ""}
      </div>
    </div>`;

  const deleteBtn = card.querySelector(".eval-delete-btn");
if (deleteBtn) {
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Voulez-vous masquer cette évaluation de votre agenda personnel ?")) {
        try {
          // 🛡️ ESBORRAT PERSONAL
          userEvalsMasquees[id] = true;
          await setDoc(doc(db, "utilisateurs", currentUser.uid), { evalsMasquees: { [id]: true } }, { merge: true });
          
          card.remove(); // L'amaguem visualment
          toast("✅ Évaluation masquée !");
        } catch (err) {
          console.error(err);
          toast("❌ Erreur");
        }
      }
    });
  }

  return card;
}

function startListeningDevoirs() {
  if (unsubscribeDevoirs) unsubscribeDevoirs();
  const feed = $("devoirs-feed");
  if (!feed) return;

  showSkeletons(feed, 4, "devoir-skeleton");
  const q = query(collection(db, "devoirs"), orderBy("timestamp", "desc"), limit(60));

  unsubscribeDevoirs = onSnapshot(q, (snap) => {
    const feed = $("devoirs-feed");
    if (!feed) return;
    feed.innerHTML = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (snap.empty) {
      activeDevoirsList = [];
      updateStats(activeDevoirsList);
      feed.innerHTML = `<div class="empty-state">
          <span class="material-symbols-outlined">assignment_turned_in</span>
          <p>Aucun devoir pour le moment !<br>Clique sur + pour en ajouter un.</p>
        </div>`;
      return;
    }

    // CORRECCIÓ DE FILTRE: Netegem els deures caducats abans de calcular les estadístiques reals
    const validDocs = [];
    snap.docs.forEach((d) => {
      if (userDevoirsMasques[d.id]) return;
      const data = d.data();
      if (data.date_limite) {
        const limitDate = data.date_limite.toDate ? data.date_limite.toDate() : new Date(data.date_limite);
        if (limitDate < today) {
          return;
        }
      }
      validDocs.push({ id: d.id, ...data });
    });

    // Guardem de manera global la llista neta filtrada i executem l'actualització de dades
    activeDevoirsList = validDocs;
    updateStats(activeDevoirsList);

    // Endreçar llista: els fets a baix de tot per prioritzar el que tenim pendent
    const sortedDocs = [...activeDevoirsList].sort((a, b) => {
      const fa = userDevoirsFaits[a.id] ? 1 : 0;
      const fb = userDevoirsFaits[b.id] ? 1 : 0;
      return fa - fb;
    });

    sortedDocs.forEach((data) => {
      feed.appendChild(buildDevoirCard(data.id, data));
    });
  },
    (err) => {
      console.error(err);
      if (feed) feed.innerHTML = `<div class="empty-state"><p>Impossible de charger les devoirs.</p></div>`;
    }
  );
}

function startListeningEvals() {
  if (unsubscribeEvals) unsubscribeEvals();
  const feed = $("evaluations-feed");
  if (!feed) return;

  showSkeletons(feed, 3, "devoir-skeleton");
  const q = query(collection(db, "evaluations"), orderBy("timestamp", "desc"), limit(40));

  unsubscribeEvals = onSnapshot(q, (snap) => {
    const feed = $("evaluations-feed");
    if (!feed) return;
    feed.innerHTML = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (snap.empty) {
      feed.innerHTML = `<div class="empty-state">
          <span class="material-symbols-outlined">quiz</span>
          <p>Aucune évaluation à venir.<br>Bonne nouvelle ! 🎉</p>
        </div>`;
      return;
    }

    snap.docs.forEach((d) => {
      if (userEvalsMasquees[d.id]) return;
      const data = d.data();
      if (data.date) {
        const evalDate = data.date.toDate ? data.date.toDate() : new Date(data.date);
        if (evalDate < today) {
          return;
        }
      }
      feed.appendChild(buildEvalCard(d.id, data));
    });
  },
    (err) => {
      console.error(err);
      if (feed) feed.innerHTML = `<div class="empty-state"><p>Impossible de charger les évaluations.</p></div>`;
    }
  );
}

function switchView(view) {
  currentView = view;
  const devoirsFeed = $("devoirs-feed");
  const evalFeed = $("evaluations-feed");
  const devoirsStats = $("devoirs-stats-block");
  const devoirsFilters = $("devoirs-filter-bar");
  const fabDevoir = $("fab-new-devoir");
  const btnDevoirs = $("toggle-devoirs");
  const btnEvals = $("toggle-evaluations");

  if (view === "devoirs") {
    if (devoirsFeed) devoirsFeed.style.display = "";
    if (evalFeed) evalFeed.style.display = "none";
    if (devoirsStats) devoirsStats.style.display = "";
    if (devoirsFilters) devoirsFilters.style.display = "";
    if (fabDevoir) fabDevoir.style.display = "flex";
    const fabEval = $("fab-new-eval");
    if (fabEval) fabEval.style.display = "none";
    if (btnDevoirs) { btnDevoirs.classList.add("section-toggle__btn--active"); }
    if (btnEvals) { btnEvals.classList.remove("section-toggle__btn--active"); }
    startListeningDevoirs();
    if (unsubscribeEvals) { unsubscribeEvals(); unsubscribeEvals = null; }
  } else {
    if (devoirsFeed) devoirsFeed.style.display = "none";
    if (evalFeed) evalFeed.style.display = "";
    if (devoirsStats) devoirsStats.style.display = "none";
    if (devoirsFilters) devoirsFilters.style.display = "none";
    if (fabDevoir) fabDevoir.style.display = "none";
    const fabEval = $("fab-new-eval");
    if (fabEval) fabEval.style.display = "flex";
    if (btnDevoirs) { btnDevoirs.classList.remove("section-toggle__btn--active"); }
    if (btnEvals) { btnEvals.classList.add("section-toggle__btn--active"); }
    startListeningEvals();
    if (unsubscribeDevoirs) { unsubscribeDevoirs(); unsubscribeDevoirs = null; }
  }
}

// Lightbox global — ouvre une image en plein écran
function openLightbox(url) {
  if (!url) return;
  const lb = document.getElementById("modal-lightbox");
  const img = document.getElementById("lightbox-img");
  if (!lb || !img) return;
  img.src = url;
  lb.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("modal-lightbox");
  const img = document.getElementById("lightbox-img");
  if (lb) lb.style.display = "none";
  if (img) img.src = "";
  document.body.style.overflow = "";
}

async function uploadDevoirImage(file) {
  const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
  if (!isImage || file.size > 20 * 1024 * 1024) { 
      toast("⚠️ Seules les images (max 20 Mo) sont autorisées."); 
      return; 
  }
  toast("⏳ Envoi de l'image du devoir...");
  const reader = new FileReader();

  reader.onload = async () => {
    const base64 = reader.result.split(",")[1];
    const formData = new FormData();
    formData.append("key", "f11ee06544b643038a4d1f7e4d823924");
    formData.append("image", base64);

    try {
      const response = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("ImgBB HTTP " + response.status);
      const result = await response.json();
      if (!result.success) throw new Error("ImgBB upload failed");

      devoirUploadedImageUrl = result.data.display_url;

      // Muestra la vista previa en el modal
      const previewImg = $("devoir-preview-img");
      const previewWrap = $("devoir-image-preview-wrap");
      if (previewImg && previewWrap) {
        previewImg.src = devoirUploadedImageUrl;
        previewWrap.style.display = "block";
      }
      toast("✅ Image du devoir prête !");
    } catch (error) {
      console.error("Error uploading devoir image:", error);
      toast("❌ Échec de l'envoi de l'image. Privilégiez un lien Google Drive si le problème persiste.");
    }
  };
  reader.readAsDataURL(file);
}

function wireEvents() {
  if (eventsWired) return;
  eventsWired = true;

  $("toggle-devoirs")?.addEventListener("click", () => switchView("devoirs"));
  $("toggle-evaluations")?.addEventListener("click", () => switchView("evaluations"));

  // Cierre del lightbox al pulsar el overlay o el botón X
  document.addEventListener("click", (e) => {
    if (e.target.id === "modal-lightbox" || e.target.closest("#lightbox-close")) {
      closeLightbox();
    }
  });

  // Cerrar con tecla Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  // Delegación de eventos para el botón de adjuntar foto (funciona aunque el modal esté oculto al init)
  document.addEventListener("click", (e) => {
    if (e.target.closest("#devoir-attach-btn")) {
      document.getElementById("devoir-file-input")?.click();
    }
  });

  // Cambio de archivo: sube a ImgBB
  document.addEventListener("change", (e) => {
    if (e.target.id === "devoir-file-input") {
      const file = e.target.files?.[0];
      if (file) {
        const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
        if (!isImage || file.size > 20 * 1024 * 1024) { 
            toast("⚠️ Seules les images (max 20 Mo) sont autorisées."); 
        } 
        else { uploadDevoirImage(file); }
      }
      e.target.value = "";
    }
  });

  const resetDevoirImage = () => {
    devoirUploadedImageUrl = "";
    const wrap = $("devoir-image-preview-wrap");
    const img = $("devoir-preview-img");
    if (wrap) wrap.style.display = "none";
    if (img) img.src = "";
  };

  const openModal = () => {
    if (!currentUser) { toast("⚠️ Connecte-toi d'abord !"); return; }
    document.body.style.overflow = "hidden";
    const modal = $("modal-new-devoir");
    if (!modal) return;
    history.pushState({ modalOpen: true }, ""); // 👈 AFEGEIX AQUESTA LÍNIA
    modal.classList.add("open");
    $("devoir-titre")?.focus();
    ["devoir-titre", "devoir-date"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    resetDevoirImage();
    const sel = $("devoir-matiere");
    if (sel) {
      if (!sel.options.length || sel.options.length < 5) sel.innerHTML = buildMatiereOptions();
      sel.value = "Mathématiques";
    }
    const btn = $("btn-submit-devoir");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined">add_task</span> Ajouter le devoir`;
    }
  };
  const closeModal = () => {
    document.body.style.overflow = "";
    $("modal-new-devoir")?.classList.remove("open");
    resetDevoirImage();
  };

  $("fab-new-devoir")?.addEventListener("click", openModal);
  $("btn-cancel-devoir")?.addEventListener("click", closeModal);
  $("modal-new-devoir")?.addEventListener("click", (e) => {
    if (e.target === $("modal-new-devoir")) closeModal();
  });

  $("btn-submit-devoir")?.addEventListener("click", async () => {
    const titre = $("devoir-titre")?.value.trim();
    const matiere = $("devoir-matiere")?.value;
    const dateVal = $("devoir-date")?.value;
    const imageUrl = devoirUploadedImageUrl || null;
    const btnSubmit = $("btn-submit-devoir");

    if (!titre) {
      const inp = $("devoir-titre");
      if (inp) {
        inp.focus();
        inp.style.borderColor = "var(--color-error)";
        setTimeout(() => inp.style.borderColor = "", 1500);
      }
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="material-symbols-outlined" style="animation:spin .7s linear infinite">progress_activity</span> Ajout…`;
    }

    try {
      await addDoc(collection(db, "devoirs"), {
        matiere,
        titre,
        imageUrl,
        date_limite: dateVal ? new Date(dateVal) : null,
        fait: false,
        auteurUid: currentUser.uid,
        auteurNom: currentUser.displayName || currentUser.email.split("@")[0] || "Élève",
        timestamp: serverTimestamp(),
      });
      closeModal();
      toast("✅ Devoir ajouté !");
    } catch (err) {
      console.error(err);
      toast("❌ Erreur lors de l'ajout");
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span class="material-symbols-outlined">add_task</span> Ajouter le devoir`;
      }
    }
  });

  $("fab-new-eval")?.addEventListener("click", openEvalModal);
  $("btn-cancel-eval")?.addEventListener("click", closeEvalModal);
  $("modal-new-eval")?.addEventListener("click", (e) => {
    if (e.target === $("modal-new-eval")) closeEvalModal();
  });
  $("btn-submit-eval")?.addEventListener("click", submitEval);
}

function openEvalModal() {
  if (!currentUser) { toast("⚠️ Connecte-toi d'abord !"); return; }
  document.body.style.overflow = "hidden";
  const modal = $("modal-new-eval");
  if (!modal) return;
  ["eval-sujet", "eval-date", "eval-coefficient", "eval-professeur"]
    .forEach(id => { const el = $(id); if (el) el.value = ""; });
  const selMat = $("eval-matiere");
  if (selMat) { selMat.innerHTML = buildMatiereOptions(); selMat.value = "Mathématiques"; }
  const selType = $("eval-type");
  if (selType) selType.value = "Contrôle";

  const btnSubmit = $("btn-submit-eval");
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span class="material-symbols-outlined">quiz</span> Ajouter l'évaluation`;
  }
history.pushState({ modalOpen: true }, ""); // 👈 AFEGEIX AQUESTA LÍNIA
  modal.classList.add("open");
  $("eval-sujet")?.focus();
}

function closeEvalModal() {
  document.body.style.overflow = "";
  $("modal-new-eval")?.classList.remove("open");
}

async function submitEval() {
  if (!currentUser) { toast("🔒 Connecte-toi d'abord !"); return; }
  const matiere = $("eval-matiere")?.value;
  const type = $("eval-type")?.value.trim() || null;
  const sujet = $("eval-sujet")?.value.trim() || null;
  const dateVal = $("eval-date")?.value;
  const coefficient = parseFloat($("eval-coefficient")?.value) || null;
  const professeur = $("eval-professeur")?.value.trim() || null;
  const btnSubmit = $("btn-submit-eval");

  if (!matiere || !dateVal) { toast("⚠️ Matière et date obligatoires."); return; }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="material-symbols-outlined" style="animation:spin .7s linear infinite">progress_activity</span> Ajout…`;
  }

  try {
    await addDoc(collection(db, "evaluations"), {
      matiere,
      type,
      sujet,
      date: new Date(dateVal),
      coefficient,
      professeur,
      auteurUid: currentUser.uid,
      auteurNom: currentUser.displayName || currentUser.email.split("@")[0] || "Élève",
      timestamp: serverTimestamp(),
    });
    closeEvalModal();
    toast("✅ Évaluation ajoutée !");
  } catch (err) {
    console.error(err);
    toast("❌ Erreur lors de l'ajout");
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span class="material-symbols-outlined">quiz</span> Ajouter l'évaluation`;
    }
  }
}

function wireFilters() {
  if (filtersWired) return;
  filtersWired = true;
  document.querySelectorAll(".devoir-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".devoir-filter-btn").forEach((b) => {
        b.classList.toggle("filter-btn--active", b === btn);
        b.classList.toggle("filter-btn--inactive", b !== btn);
      });
      const filter = btn.dataset.filter;
      document.querySelectorAll(".devoir-card").forEach((card) => {
        const done = card.classList.contains("devoir-card--done");
        if (filter === "tous") card.style.display = "";
        if (filter === "en-cours") card.style.display = done ? "none" : "";
        if (filter === "faits") card.style.display = done ? "" : "none";
      });
    });
  });
}
let popstateWiredDevoirs = false; // 👈 Variable de control nova
export function initDevoirs() {
  if (!popstateWiredDevoirs) {
    popstateWiredDevoirs = true;
    window.addEventListener("popstate", () => {
      $("modal-new-devoir")?.classList.remove("open");
      $("modal-new-eval")?.classList.remove("open");
      closeLightbox(); // Aprofitem per tancar imatges obertes en gran
    });
  }
  wireEvents();
  wireFilters();

  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    const prevUser = currentUser;
    currentUser = user;
    if (!user) {
      userDevoirsFaits = {};
      if (unsubscribeFaits) { unsubscribeFaits(); unsubscribeFaits = null; }
      document.querySelectorAll(".devoir-card").forEach(card => {
        card.classList.remove("devoir-card--done");
        const cb = card.querySelector(".devoir-checkbox__input");
        if (cb) cb.checked = false;
      });
      const sF = $("devoirs-stats-faits"); if (sF) sF.textContent = "0";
      const sB = $("devoirs-progress-bar"); if (sB) sB.style.width = "0%";
      return;
    }

if (prevUser?.uid !== user.uid) {
      if (unsubscribeFaits) { unsubscribeFaits(); unsubscribeFaits = null; }
      unsubscribeFaits = onSnapshot(doc(db, "utilisateurs", user.uid),
        (snap) => {
          const data = snap.data() || {};
          userDevoirsFaits = data.devoirsFaits ?? {};
          userDevoirsMasques = data.devoirsMasques ?? {}; // 👈 Carrega els deures esborrats
          userEvalsMasquees = data.evalsMasquees ?? {};   // 👈 Carrega les avaluacions esborrades

          if (currentView === "devoirs") {
            if (!unsubscribeDevoirs) {
              startListeningDevoirs();
            } else {
              updateStats(activeDevoirsList);
              document.querySelectorAll(".devoir-card").forEach(card => {
                const id = card.getAttribute("data-id");
                // 🛡️ Si l'ha esborrat personalment, l'amaguem de la pantalla
                if (userDevoirsMasques[id]) {
                  card.style.display = "none";
                  return;
                }
                const fait = userDevoirsFaits[id] === true;
                card.classList.toggle("devoir-card--done", fait);
                const cb = card.querySelector(".devoir-checkbox__input");
                if (cb) cb.checked = fait;
              });
            }
          } else {
            if (!unsubscribeEvals) startListeningEvals();
          }
        },
        (err) => console.warn(err)
      );
    }
  }); // 👈 ATENCIÓ: Aquestes són les dues línies que s'havien esborrat

  switchView(currentView);
}

export function destroyDevoirs() {
  if (unsubscribeDevoirs) { unsubscribeDevoirs(); unsubscribeDevoirs = null; }
  if (unsubscribeEvals) { unsubscribeEvals(); unsubscribeEvals = null; }
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  if (unsubscribeFaits) { unsubscribeFaits(); unsubscribeFaits = null; }
}
