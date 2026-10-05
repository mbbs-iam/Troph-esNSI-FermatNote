// ================================================================
//  forum.js — Composant Forum (style Reddit)
//  Lycée Skillforge · Hub de Classe
//  Clean, DRY & Scalable (Refactorisation de Nettoyage & Optimisation RAM)
// ================================================================

import { db, auth } from "./firebase.js";
import { getMatiereColor } from "./matieres.js";
import { esc, toast, initials, avatarColor, formatDate, showSkeletons, showEmptyState, linkify, compressImageToBase64 } from "./utils.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  runTransaction,
  addDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

let currentUser = null;
const userVotes = {};
let unsubscribePosts = null;
let unsubscribeAuth = null;
let currentSort = "recent";
let selectedTags = [];
let filtersWired = false;
let escHandler = null;
let unsubscribeReplies = null;
let activePostId = null;
let repliesWired = false;
let forumSelectedFile = null;
let replySelectedFile = null;
let userForumMasques = {};
let unsubscribeProfile = null;
let currentPreviewUrl = null;

const IMGBB_API_KEY = "f11ee06544b643038a4d1f7e4d823924";
const $ = (id) => document.getElementById(id);

function buildPostCard(postId, data) {
  const card = document.createElement("article");
  card.className = "post-card";
  card.setAttribute("data-id", postId);
  card.setAttribute("role", "article");

  const up = data.votes?.up ?? 0;
  const down = data.votes?.down ?? 0;
  const score = up - down;
  const myVote = userVotes[postId] ?? null;
  const scoreClass = score > 0 ? "positive" : score < 0 ? "negative" : "";

  const tagsHtml = (data.tags ?? [])
    .map((tag) => {
      const isMat = tag.type === "matiere";
      const color = isMat ? getMatiereColor(tag.label) : null;
      const r = color ? parseInt(color.slice(1, 3), 16) : 0;
      const g = color ? parseInt(color.slice(3, 5), 16) : 0;
      const b = color ? parseInt(color.slice(5, 7), 16) : 0;
      const tagStyle = color ? `style="color:${color};background:rgba(${r},${g},${b},0.13);border-color:rgba(${r},${g},${b},0.45);"` : "";
      const cls = isMat ? "post-tag--matiere" : tag.type === "type" ? "post-tag--type" : "post-tag--general";
      return `<span class="post-tag ${cls}" data-tag="${esc(tag.label)}" ${tagStyle}>${esc(tag.label)}</span>`;
    }).join("");

  // Utilitza directament la dada de l'avatar incrustada, eliminant la descàrrega de tots els usuaris O(N)
  const currentAvatarUrl = data.avatarUrl;
  const avatarHtml = currentAvatarUrl
    ? `<img class="post-avatar" src="${esc(currentAvatarUrl)}" alt="${esc(data.auteurNom ?? "")}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <span class="post-avatar--initials" style="display:none;background:${avatarColor(data.auteurUid)}">${initials(data.auteurNom)}</span>`
    : `<span class="post-avatar--initials" style="background:${avatarColor(data.auteurUid)}">${initials(data.auteurNom)}</span>`;

  const deleteBtnHtml = currentUser 
    ? `<button class="post-delete-btn" data-action="delete" aria-label="Supprimer" style="background:none; border:none; color:var(--color-error); cursor:pointer; display:inline-flex; align-items:center; margin-left:auto;"><span class="material-symbols-outlined" style="font-size:1.25rem;">delete</span></button>` 
    : "";

  card.innerHTML = `
    <div class="post-card__votes" aria-label="Votes">
      <button class="vote-btn ${myVote === "up" ? "vote-btn--up-active" : ""}" data-action="up" aria-pressed="${myVote === "up"}">
        <span class="material-symbols-outlined">arrow_upward</span>
      </button>
      <span class="vote-score ${scoreClass}" aria-live="polite">${score}</span>
      <button class="vote-btn ${myVote === "down" ? "vote-btn--down-active" : ""}" data-action="down" aria-pressed="${myVote === "down"}">
        <span class="material-symbols-outlined">arrow_downward</span>
      </button>
    </div>
    <div class="post-card__body">
      <div class="post-card__meta">
        ${avatarHtml}
        <div class="post-author-info">
          <span class="post-author-name">${esc(data.auteurNom ?? "Élève")}</span>
          <span class="post-author-time">${formatDate(data.timestamp, "relative")}</span>
        </div>
      </div>
      ${tagsHtml ? `<div class="post-tags">${tagsHtml}</div>` : ""}
      <h3 class="post-title">${esc(data.titre ?? "Sans titre")}</h3>
      ${data.corps ? `<p class="post-body">${linkify(data.corps)}</p>` : ""}
      ${data.imageUrl 
        ? `<div style="margin-top: 0.75rem; border-radius: var(--radius-lg); overflow: hidden; border: 2px solid var(--color-primary);"><img class="forum-post-img" src="${esc(data.imageUrl)}" style="width:100%; display:block; max-height:250px; object-fit:cover; cursor:zoom-in;" loading="lazy" /></div>`
        : data.fileUrl
        ? `<a href="${esc(data.fileUrl)}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:8px; margin-top:.75rem; background:rgba(0,0,0,.08); padding:10px 14px; border-radius:10px; border:1.5px solid var(--color-primary); text-decoration:none;">
            <span class="material-symbols-outlined" style="font-size:1.5rem; color:var(--color-primary); font-variation-settings:'FILL' 1;">picture_as_pdf</span>
            <span style="font-family:var(--font-label); font-size:.85rem; font-weight:700; color:var(--color-primary); word-break:break-all;">${esc(data.fileName || "Document.pdf")}</span>
           </a>`
        : ""}
      <div class="post-card__footer">
        <button class="post-action-btn post-action-btn--replies" aria-label="Voir les réponses">
          <span class="material-symbols-outlined">chat_bubble</span>
          ${data.reponsesCount ?? 0} réponse${(data.reponsesCount ?? 0) !== 1 ? "s" : ""}
        </button>
        <button class="post-action-btn post-action-btn--share" data-action="share" aria-label="Partager">
          <span class="material-symbols-outlined">share</span> Partager
        </button>
        ${deleteBtnHtml}
      </div>
    </div>`;

  card.querySelector('[data-action="up"]').addEventListener("click", (e) => { e.stopPropagation(); voter(postId, "up"); });
  card.querySelector('[data-action="down"]').addEventListener("click", (e) => { e.stopPropagation(); voter(postId, "down"); });
  card.querySelector('[data-action="share"]')?.addEventListener("click", (e) => { e.stopPropagation(); partagerPost(data); });
  card.querySelector('.post-action-btn--replies')?.addEventListener("click", (e) => { e.stopPropagation(); ouvrirReponses(postId, data); });

  card.querySelector(".forum-post-img")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const lb  = document.getElementById("modal-lightbox");
    const img = document.getElementById("lightbox-img");
    if (lb && img && data.imageUrl) {
      img.src = data.imageUrl;
      lb.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  });
  
  if (currentUser) {
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Voulez-vous masquer cette question de votre fil personnel ?")) {
        try {
          await setDoc(doc(db, "utilisateurs", currentUser.uid), { forumMasques: { [postId]: true } }, { merge: true });
          card.remove();
          toast("✅ Question masquée !");
        } catch (err) {
          console.error(err);
          toast("❌ Erreur de masquage");
        }
      }
    });
  }

  return card;
}

async function voter(postId, direction) {
  if (!currentUser) { toast("🔒 Connecte-toi pour voter !"); return; }
  const postRef = doc(db, "forum_questions", postId);
  const prevVote = userVotes[postId] ?? null;
  const isSameDir = prevVote === direction;

  updateVoteUI(postId, isSameDir ? null : direction);

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(postRef);
      if (!snap.exists()) throw new Error("Post introuvable");
      const votes = snap.data().votes ?? { up: 0, down: 0 };
      if (prevVote) votes[prevVote] = Math.max(0, (votes[prevVote] ?? 0) - 1);
      if (!isSameDir) votes[direction] = (votes[direction] ?? 0) + 1;
      transaction.update(postRef, { votes });
    });
  } catch (err) {
    console.error(err);
    updateVoteUI(postId, prevVote);
    toast("❌ Erreur, réessaie");
  }
}

function updateVoteUI(postId, direction) {
  userVotes[postId] = direction;
  const feed = $("forum-feed");
  const card = feed?.querySelector(`[data-id="${postId}"]`);
  if (!card) return;
  const upBtn = card.querySelector('[data-action="up"]');
  const downBtn = card.querySelector('[data-action="down"]');
  const score = card.querySelector(".vote-score");
  upBtn.classList.toggle("vote-btn--up-active", direction === "up");
  downBtn.classList.toggle("vote-btn--down-active", direction === "down");
  upBtn.setAttribute("aria-pressed", String(direction === "up"));
  downBtn.setAttribute("aria-pressed", String(direction === "down"));
  score.style.transform = "scale(1.25)";
  setTimeout(() => score.style.transform = "", 200);
}

async function partagerPost(data) {
  if (navigator.share) {
    try { await navigator.share({ title: data.titre, text: data.corps ?? "", url: window.location.href }); } catch (e) {}
  } else {
    await navigator.clipboard.writeText(window.location.href);
    toast("🔗 Lien copié !");
  }
}

function startListening(sort = "recent") {
  if (unsubscribePosts) unsubscribePosts();
  const feed = $("forum-feed");
  if (!feed) return;

  showSkeletons(feed, 3, "post-skeleton");
  const q = query(collection(db, "forum_questions"), orderBy("timestamp", "desc"), limit(60));

  unsubscribePosts = onSnapshot(q, (snapshot) => {
      feed.innerHTML = "";
      if (snapshot.empty) { showEmptyState(feed, "forum", "Sois le premier à poser une question !"); return; }
      let docs = snapshot.docs;
      docs = docs.filter(d => !userForumMasques[d.id]);
      if (sort === "popular") {
        docs = [...docs].sort((a, b) => {
          const scoreA = (a.data().votes?.up ?? 0) - (a.data().votes?.down ?? 0);
          const scoreB = (b.data().votes?.up ?? 0) - (b.data().votes?.down ?? 0);
          return scoreB - scoreA;
        });
      }
      docs.forEach((docSnap) => feed.appendChild(buildPostCard(docSnap.id, docSnap.data())));
    },
    (err) => {
      console.error(err);
      if (feed) feed.innerHTML = `<div class="empty-state"><p>Impossible de charger les posts.</p></div>`;
    }
  );
}

function openModal() {
  if (!currentUser) { toast("🔒 Connecte-toi pour poster !"); return; }
  document.body.style.overflow = "hidden";
  const modal = $("modal-new-post");
  if (!modal) return;

  history.pushState({ modalOpen: true }, ""); 
  modal.classList.add("open");

  const formTitre = $("new-post-titre");
  const formCorps = $("new-post-corps");
  const btnSubmit = $("btn-submit-post");
  forumSelectedFile = null; 
  if ($("forum-image-preview-wrap")) $("forum-image-preview-wrap").style.display = "none"; 
  if ($("forum-preview-img")) $("forum-preview-img").src = "";

  formTitre?.focus();
  if (formTitre) formTitre.value = "";
  if (formCorps) formCorps.value = "";
  selectedTags = [];
  document.querySelectorAll(".tag-option").forEach((t) => t.classList.remove("selected"));
  const fileInput = $("forum-file-input");
  if (fileInput) fileInput.value = "";
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span class="material-symbols-outlined">send</span> Publier la question`;
  }
}

function closeModal() {
  document.body.style.overflow = "";
  $("modal-new-post")?.classList.remove("open");
  
  const imgEl = document.getElementById("forum-preview-img");
  if (imgEl && imgEl.src && imgEl.src.startsWith("blob:")) {
      URL.revokeObjectURL(imgEl.src);
      imgEl.src = "";
  }
  forumSelectedFile = null;
}

document.querySelectorAll(".tag-option").forEach((tag) => {
  const color = getMatiereColor(tag.dataset.tag);
  if (color && tag.dataset.type === "matiere") {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    tag.style.color = color;
    tag.style.borderColor = color;
    tag.style.background = `rgba(${r},${g},${b},0.1)`;
  }
  tag.addEventListener("click", () => {
    const value = tag.dataset.tag;
    if (tag.classList.contains("selected")) {
      tag.classList.remove("selected");
      tag.style.background = tag.style.color = tag.style.borderColor = "";
      selectedTags = selectedTags.filter((t) => t.label !== value);
    } else {
      tag.classList.add("selected");
      const c = getMatiereColor(value);
      if (c && tag.dataset.type === "matiere") {
        tag.style.background = c;
        tag.style.color = "#fff";
        tag.style.borderColor = c;
      }
      selectedTags.push({ label: value, type: tag.dataset.type ?? "general" });
    }
  });
});

$("btn-submit-post")?.addEventListener("click", async () => {
  const formTitre = $("new-post-titre");
  const formCorps = $("new-post-corps");
  const btnSubmit = $("btn-submit-post");
  const titre = formTitre?.value.trim();
  const corps = formCorps?.value.trim();

  if (!titre) {
    if (formTitre) {
      formTitre.focus();
      formTitre.style.borderColor = "var(--color-error)";
      setTimeout(() => formTitre.style.borderColor = "", 1500);
    }
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="material-symbols-outlined" style="animation:spin .7s linear infinite">progress_activity</span> Publication…`;
  }

  let imageUrl = null;

  try {
    if (forumSelectedFile) { 
      toast("⏳ Envoi de l'image...");
      const base64DataUrl = await compressImageToBase64(forumSelectedFile, 1200, 1200, 0.82);
      const base64 = base64DataUrl.split(",")[1];
      const fd = new FormData(); 
      fd.append("key", IMGBB_API_KEY); 
      fd.append("image", base64); 
      
      const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd }); 
      const json = await res.json(); 
      if (!json.success) throw new Error("Erreur API ImgBB");
      imageUrl = json.data.display_url; 
    }

    await addDoc(collection(db, "forum_questions"), {
      auteurUid: currentUser.uid,
      auteurNom: currentUser.displayName ?? currentUser.email?.split("@")[0] ?? "Élève",
      avatarUrl: currentUser.photoURL ?? null,
      titre,
      corps: corps || null,
      imageUrl: imageUrl || null,
      tags: selectedTags,
      timestamp: serverTimestamp(),
      votes: { up: 0, down: 0 },
      reponsesCount: 0,
    });
    closeModal();
    toast("✅ Question publiée !");
  } catch (err) {
    console.error(err);
    toast("❌ Erreur, réessaie. (Peut-être image trop lourde)");
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span class="material-symbols-outlined">send</span> Publier la question`;
    }
  }
});

document.getElementById("fab-new-post")?.addEventListener("click", openModal);
document.getElementById("btn-cancel-post")?.addEventListener("click", closeModal);

if (!document.getElementById("spin-style")) {
  const s = document.createElement("style");
  s.id = "spin-style";
  s.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(s);
}

document.addEventListener("click", (e) => {
  if (e.target.id === "modal-lightbox" || e.target.closest("#lightbox-close")) {
    const lb  = document.getElementById("modal-lightbox");
    const img = document.getElementById("lightbox-img");
    if (lb)  lb.style.display = "none";
    if (img) img.src = "";
    document.body.style.overflow = "";
  }
});

function buildReplyBubble(data) {
  const div = document.createElement("div");
  div.className = "reply-bubble";

  const time = formatDate(data.timestamp, "relative");
  const init = initials(data.auteurNom);
  const color = avatarColor(data.auteurUid);

  const avatarHtml = data.avatarUrl
    ? `<img class="reply-avatar" src="${esc(data.avatarUrl)}" alt="${esc(data.auteurNom)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <span class="reply-avatar" style="display:none; background:${color};">${init}</span>`
    : `<span class="reply-avatar" style="display:flex; background:${color};">${init}</span>`;

  const imageHtml = data.imageUrl
    ? `<a href="${esc(data.imageUrl)}" target="_blank" rel="noopener" style="display:block; margin-top:.5rem;">
         <img src="${esc(data.imageUrl)}" alt="Image" loading="lazy"
           style="max-width:100%; max-height:200px; border-radius:8px; display:block; cursor:zoom-in;
                  border:1.5px solid var(--color-primary);" />
       </a>`
    : "";

  const pdfHtml = data.fileUrl
    ? `<a href="${esc(data.fileUrl)}" target="_blank" rel="noopener"
         style="display:flex; align-items:center; gap:8px; margin-top:.5rem;
                background:rgba(0,0,0,.08); padding:8px 12px; border-radius:10px;
                border:1.5px solid var(--color-primary); text-decoration:none;">
         <span class="material-symbols-outlined"
           style="font-size:1.35rem; color:var(--color-primary); font-variation-settings:'FILL' 1;">picture_as_pdf</span>
         <span style="font-family:var(--font-label); font-size:.82rem; font-weight:700;
                      color:var(--color-primary); word-break:break-all;">${esc(data.fileName || "Document.pdf")}</span>
       </a>`
    : "";

  div.innerHTML = `
    ${avatarHtml}
    <div class="reply-bubble__content">
      <div class="reply-bubble__header">
        <span class="reply-bubble__author">${esc(data.auteurNom)}</span>
        <span class="reply-bubble__time">${time}</span>
      </div>
      <p class="reply-bubble__text">${linkify(data.texte)}</p>
      ${imageHtml}${pdfHtml}
    </div>`;
  return div;
}

function wireRepliesControls() {
  if (repliesWired) return;
  repliesWired = true;

  $("btn-close-replies")?.addEventListener("click", closeReplies);
  $("modal-forum-replies")?.addEventListener("click", (e) => {
    if (e.target === $("modal-forum-replies")) closeReplies();
  });
  $("btn-submit-reply")?.addEventListener("click", envoyerReponse);
  $("forum-reply-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyerReponse(); }
  });

  $("forum-reply-attach-btn")?.addEventListener("click", () => $("forum-reply-file-input")?.click());

  $("forum-reply-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }

    const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
    const isPDF   = file.type === "application/pdf";

    if (!isImage && !isPDF) {
      toast("❌ Seuls les images et les PDF sont supportés.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast("❌ Fichier trop lourd (max 20 Mo).");
      return;
    }

    replySelectedFile = file;
    const previewDiv  = $("forum-reply-img-preview");
    const previewImg  = $("forum-reply-preview-img");
    const previewName = $("forum-reply-preview-name");

    if (isImage) {
      currentPreviewUrl = URL.createObjectURL(file);
      if (previewImg) { previewImg.src = currentPreviewUrl; previewImg.style.display = "block"; }
    } else {
      if (previewImg) { previewImg.src = ""; previewImg.style.display = "none"; }
    }
    if (previewName) previewName.textContent = (isPDF ? "📄 " : "") + file.name;
    if (previewDiv)  previewDiv.style.display = "flex";
  });
}

async function ouvrirReponses(postId, data) {
  if (!currentUser) { toast("🔒 Connecte-toi pour voir les réponses !"); return; }
  document.body.style.overflow = "hidden";
  activePostId = postId;
  const modal = $("modal-forum-replies");
  if (!modal) return;

  history.pushState({ modalOpen: true }, "");
  const titleEl = $("replies-modal-titre");
  const corpsEl = $("replies-modal-corps");
  const badgeEl = $("replies-modal-badge");

  if (titleEl) titleEl.textContent = data.titre ?? "";
  if (corpsEl) {
    corpsEl.textContent = data.corps ?? "";
    corpsEl.style.display = data.corps ? "block" : "none";
  }

  if (badgeEl) {
    const matTag = (data.tags ?? []).find(t => t.type === "matiere");
    badgeEl.textContent = matTag ? matTag.label : "Général";
    badgeEl.style.background = matTag ? getMatiereColor(matTag.label) : "#006c49";
  }

  const input = $("forum-reply-input");
  if (input) input.value = "";

  modal.classList.add("open");
  wireRepliesControls();
  startListeningReplies(postId);
}

function closeReplies() {
  document.body.style.overflow = "";
  $("modal-forum-replies")?.classList.remove("open");
  activePostId = null;
  if (unsubscribeReplies) { unsubscribeReplies(); unsubscribeReplies = null; }
  
  if (typeof currentPreviewUrl !== 'undefined' && currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
  }
  replySelectedFile = null;
}

function startListeningReplies(postId) {
  if (unsubscribeReplies) unsubscribeReplies();
  const listEl = $("forum-replies-list");
  if (!listEl) return;

  listEl.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--color-on-surface-variant);">
    <span class="material-symbols-outlined" style="animation:spin .9s linear infinite; font-size:1.5rem;">progress_activity</span>
    <br/>Chargement...
  </div>`;

  const q = query(collection(db, "forum_questions", postId, "replies"), orderBy("timestamp", "asc"));

  unsubscribeReplies = onSnapshot(q, (snap) => {
    listEl.innerHTML = "";
    if (snap.empty) {
      listEl.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--color-on-surface-variant);">
        <span class="material-symbols-outlined" style="font-size:2rem; margin-bottom:.5rem;">chat_bubble_outline</span>
        <p style="margin:0; font-size:.9rem;">Aucune réponse pour le moment.<br/>Soyez le premier à répondre !</p>
      </div>`;
      return;
    }
    snap.docs.forEach((docSnap) => { listEl.appendChild(buildReplyBubble(docSnap.data())); });
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  }, (err) => {
    console.error(err);
    listEl.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--color-error);">Erreur de chargement.</div>`;
  });
}

async function envoyerReponse() {
  const input   = $("forum-reply-input");
  const sendBtn = $("btn-submit-reply");
  const text    = input?.value.trim();

  if (!text || !activePostId) return;

  if (input)   input.disabled   = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    let imageUrl = null;
    if (replySelectedFile) {
        toast("⏳ Envoi de l'image...");
        const base64DataUrl = await compressImageToBase64(replySelectedFile, 1200, 1200, 0.82);
        const base64 = base64DataUrl.split(",")[1];
        const fd = new FormData(); 
        fd.append("key", IMGBB_API_KEY); 
        fd.append("image", base64);
        const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.success) imageUrl = json.data.display_url;
    }

    const replyRef = collection(db, "forum_questions", activePostId, "replies");
    await addDoc(replyRef, {
      texte:     text,
      imageUrl:  imageUrl || null,
      auteurUid: currentUser.uid,
      auteurNom: currentUser.displayName ?? currentUser.email.split("@")[0],
      avatarUrl: currentUser.photoURL ?? null,
      timestamp: serverTimestamp(),
    });

    const questionRef = doc(db, "forum_questions", activePostId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(questionRef);
      if (!snap.exists()) return;
      transaction.update(questionRef, { reponsesCount: (snap.data().reponsesCount ?? 0) + 1 });
    });

    if (input) input.value = "";
    replySelectedFile = null;
    
    const previewDiv  = $("forum-reply-img-preview");
    if (previewDiv) previewDiv.style.display = "none";
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }

  } catch (err) {
    console.error(err);
    toast("❌ Impossible d'envoyer la réponse");
  } finally {
    if (input)   { input.disabled   = false; input.focus(); }
    if (sendBtn)  sendBtn.disabled = false;
  }
}


let popstateWired = false;
export function initForum() {
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  let firstResolve = true;

  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    const prevUser = currentUser;
    currentUser = user;
    if (!user) { for (const k in userVotes) delete userVotes[k]; }
    if (firstResolve || (prevUser?.uid !== user?.uid)) {
      firstResolve = false;
      if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
      if (user) {
        unsubscribeProfile = onSnapshot(doc(db, "utilisateurs", user.uid), (snap) => {
          userForumMasques = snap.data()?.forumMasques || {};
          startListening(currentSort);
        });
      } else {
        userForumMasques = {};
        startListening(currentSort);
      }
    }
  });

  if (!popstateWired) {
    popstateWired = true;
    window.addEventListener("popstate", () => {
      if ($("modal-forum-replies")?.classList.contains("open")) {
        closeReplies();
      }
      if ($("modal-new-post")?.classList.contains("open")) {
        closeModal();
      }
    });
  }

  if (!filtersWired) {
    filtersWired = true;
    document.querySelectorAll(".filter-btn[data-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sort = btn.dataset.sort;
        if (sort === currentSort) return;
        currentSort = sort;
        document.querySelectorAll(".filter-btn[data-sort]").forEach((b) => {
          b.classList.toggle("filter-btn--active", b === btn);
          b.classList.toggle("filter-btn--inactive", b !== btn);
        });
        startListening(sort);
      });
    });
  }

  escHandler = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", escHandler);
}

export function destroyForum() {
  if (unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
  if (unsubscribeReplies) { unsubscribeReplies(); unsubscribeReplies = null; }
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
  if (escHandler) { document.removeEventListener("keydown", escHandler); escHandler = null; }
}

$("forum-attach-btn")?.addEventListener("click", () => $("forum-file-input")?.click());

$("forum-file-input")?.addEventListener("change", (e) => { 
    const file = e.target.files?.[0]; 
    if (!file) return; 
    const isImage = file.type.startsWith("image/") || file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i); 
    if (!isImage || file.size > 20 * 1024 * 1024) { 
        toast("⚠️ Seules les images (max 20 Mo) sont autorisées."); 
        return; 
    } 
    forumSelectedFile = file; 
    const imgEl = $("forum-preview-img");
    if (imgEl) {
        if (imgEl.src && imgEl.src.startsWith("blob:")) URL.revokeObjectURL(imgEl.src);
        imgEl.src = URL.createObjectURL(file);
    } 
    if ($("forum-image-preview-wrap")) $("forum-image-preview-wrap").style.display = "block"; 
});
