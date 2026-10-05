// ================================================================
//  courrier.js — Composant Courrier International
//  Lycée Skillforge · Hub de Classe
//  ----------------------------------------------------------------
//  • Flux RSS réels : Le Monde, Courrier International, Nature
//  • Proxies CORS : allorigins.win → corsproxy.io → rss2json (cascade)
//  • Parsing XML natif (DOMParser) — aucune clé API requise
//  • Cache Firestore pour le mode hors-ligne
//  • Tri par date, filtres catégorie côté client
// ================================================================

import { db, auth } from "./firebase.js";
import { esc, formatDate, toast, showSkeletons, showEmptyState } from "./utils.js";
import { collection, query, orderBy, limit, onSnapshot, setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ----------------------------------------------------------------
//  ÉTAT LOCAL
// ----------------------------------------------------------------
let unsubscribeCourrier = null;
let filtersWired        = false;
let currentFilter       = "tous";
let fetchInProgress     = false;

// ----------------------------------------------------------------
//  RÉFÉRENCE DOM (lazy)
// ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------
//  CONFIG CATÉGORIES
// ----------------------------------------------------------------
const CAT_COLORS = {
  "Monde":         { bg: "#3B82F6", icon: "public"      },
  "Société":       { bg: "#10B981", icon: "groups"       },
  "Sciences":      { bg: "#8B5CF6", icon: "science"      },
  "Culture":       { bg: "#F97316", icon: "palette"      },
  "Économie":      { bg: "#0EA5E9", icon: "trending_up"  },
  "Environnement": { bg: "#16A34A", icon: "eco"          },
  "Technologie":   { bg: "#6366F1", icon: "memory"       },
};
const DEFAULT_CAT = { bg: "#3B82F6", icon: "article" };

// ----------------------------------------------------------------
//  FLUX RSS — Sources configurées
// ----------------------------------------------------------------
const RSS_FEEDS = [
  {
    name:      "Le Monde",
    url:       "https://www.lemonde.fr/rss/une.xml",
    categorie: "Monde",
  },
  {
    name:      "Courrier International",
    url:       "https://www.courrierinternational.com/feed/all/rss.xml",
    categorie: "Monde",
  },
  {
    name:      "Nature",
    url:       "https://www.nature.com/nature.rss",
    categorie: "Sciences",
  },
];

const MAX_PER_FEED = 8;   // Articles max par source
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures avant re-fetch

// ----------------------------------------------------------------
//  UTILITAIRES LOCAUX
// ----------------------------------------------------------------

// Supprime les balises HTML d'un texte
function stripHtml(html) {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Extrait l'image depuis diverses sources RSS
function extractImageFromItem(item) {
  // 1. Media content (balise <media:content>)
  const mediaContent = item.querySelector("content") ||
                       item.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "content")[0] ||
                       item.getElementsByTagName("media:content")[0];
  if (mediaContent?.getAttribute("url")) return mediaContent.getAttribute("url");

  // 2. Media thumbnail
  const mediaThumbnail = item.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "thumbnail")[0] ||
                         item.getElementsByTagName("media:thumbnail")[0];
  if (mediaThumbnail?.getAttribute("url")) return mediaThumbnail.getAttribute("url");

  // 3. Enclosure
  const enclosure = item.querySelector("enclosure");
  if (enclosure?.getAttribute("type")?.startsWith("image")) return enclosure.getAttribute("url");

  // 4. Cherche dans description/content:encoded
  const contentEncoded = item.getElementsByTagName("content:encoded")[0];
  const descEl = item.querySelector("description");
  const rawHtml = contentEncoded?.textContent || descEl?.textContent || "";
  const match = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

// ----------------------------------------------------------------
//  FETCH D'UN FLUX RSS — Cascade de proxies CORS
// ----------------------------------------------------------------

/** Proxy 1 : allorigins.win — renvoie le XML brut */
async function fetchViaAllOrigins(rssUrl) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`allorigins HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.contents) throw new Error("allorigins: contenu vide");
  return json.contents; // chaîne XML brute
}

/** Proxy 2 : corsproxy.io — renvoie le XML brut directement */
async function fetchViaCorsproxy(rssUrl) {
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`;
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`corsproxy HTTP ${resp.status}`);
  return await resp.text();
}

/** Proxy 3 (fallback) : rss2json.com — renvoie du JSON */
async function fetchViaRss2Json(rssUrl, count = MAX_PER_FEED) {
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${count}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`rss2json HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.status !== "ok") throw new Error(`rss2json: ${json.message}`);
  // Convertit en format tableau d'articles normalisé
  return (json.items ?? []).map(item => ({
    titre:     (item.title ?? "").trim(),
    resume:    stripHtml(item.description ?? item.content ?? "").substring(0, 200) || null,
    url:       item.link ?? item.guid ?? null,
    imageUrl:  item.thumbnail && item.thumbnail !== "self" ? item.thumbnail
               : item.enclosure?.link ?? null,
    date:      item.pubDate ? new Date(item.pubDate) : new Date(),
  }));
}

/** Parse le XML RSS brut et retourne les articles normalisés */
function parseRssXml(xmlText, feedConfig) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "application/xml");

  // Vérifie si le parsing a échoué
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) throw new Error(`XML invalide pour ${feedConfig.name}`);

  const items = Array.from(xmlDoc.querySelectorAll("item")).slice(0, MAX_PER_FEED);

  return items.map(item => {
    const getText = (tag) => item.querySelector(tag)?.textContent?.trim() ?? "";
    const title       = getText("title");
    const link        = getText("link") || item.querySelector("guid")?.textContent?.trim() || null;
    const description = getText("description");
    const pubDate     = getText("pubDate");
    const imageUrl    = extractImageFromItem(item);
    const resume      = stripHtml(description).substring(0, 200) || null;

    return {
      titre:    title,
      resume,
      url:      link,
      imageUrl,
      date:     pubDate ? new Date(pubDate) : new Date(),
    };
  });
}

/** Tente de récupérer un flux RSS via cascade de proxies */
async function fetchFeed(feedConfig) {
  let rawArticles = null;

  // Essai 1 : allorigins → parsing XML natif
  try {
    const xml = await fetchViaAllOrigins(feedConfig.url);
    rawArticles = parseRssXml(xml, feedConfig);
    console.log(`[Courrier] ✅ allorigins OK pour "${feedConfig.name}" (${rawArticles.length} articles)`);
  } catch (e1) {
    console.warn(`[Courrier] allorigins échoué pour "${feedConfig.name}": ${e1.message}`);

    // Essai 2 : corsproxy.io → parsing XML natif
    try {
      const xml = await fetchViaCorsproxy(feedConfig.url);
      rawArticles = parseRssXml(xml, feedConfig);
      console.log(`[Courrier] ✅ corsproxy OK pour "${feedConfig.name}" (${rawArticles.length} articles)`);
    } catch (e2) {
      console.warn(`[Courrier] corsproxy échoué pour "${feedConfig.name}": ${e2.message}`);

      // Essai 3 : rss2json (JSON direct, pas de parsing XML)
      try {
        rawArticles = await fetchViaRss2Json(feedConfig.url);
        console.log(`[Courrier] ✅ rss2json OK pour "${feedConfig.name}" (${rawArticles.length} articles)`);
      } catch (e3) {
        console.error(`[Courrier] ❌ Tous les proxies ont échoué pour "${feedConfig.name}":`, e3.message);
        throw e3;
      }
    }
  }

  // Enrichit avec les métadonnées du flux
  return rawArticles.map(a => ({
    ...a,
    source:    feedConfig.name,
    categorie: feedConfig.categorie,
    _feedName: feedConfig.name,
  }));
}

// ----------------------------------------------------------------
//  ID stable basé sur source + titre (évite doublons Firestore)
// ----------------------------------------------------------------
function makeDocId(item) {
  const raw = `${item._feedName}:${item.titre}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return `rss_${Math.abs(hash).toString(36)}`;
}

// ----------------------------------------------------------------
//  SYNCHRONISATION FIRESTORE (respecte le TTL)
// ----------------------------------------------------------------
async function syncFeedsToFirestore(force = false) {
  if (fetchInProgress) return;



  fetchInProgress = true;

  const lastFetch = parseInt(localStorage.getItem("courrier-last-fetch") ?? "0", 10);
  if (!force && Date.now() - lastFetch < CACHE_TTL_MS) {
    console.log("[Courrier] Cache encore valide, pas de re-fetch RSS.");
    fetchInProgress = false;
    return;
  }

  console.log("[Courrier] 🔄 Début de la synchronisation des flux RSS…");

  try {
    const allItems = [];
    const results  = await Promise.allSettled(RSS_FEEDS.map(f => fetchFeed(f)));

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        allItems.push(...r.value);
      } else {
        console.warn(`[Courrier] Flux "${RSS_FEEDS[i].name}" inaccessible :`, r.reason?.message);
      }
    });

    if (allItems.length === 0) {
      console.warn("[Courrier] Aucun article récupéré depuis les flux RSS.");
      fetchInProgress = false;
      return;
    }

    // Écriture dans Firestore
    const writes = allItems.map(item => {
      const id = makeDocId(item);
      return setDoc(
        doc(db, "courrier_news", id),
        {
          titre:     item.titre,
          resume:    item.resume ?? null,
          url:       item.url ?? null,
          imageUrl:  item.imageUrl ?? null,
          source:    item.source,
          categorie: item.categorie,
          date:      item.date,
          _rssSync:  true,
        },
        { merge: true }
      );
    });

    await Promise.allSettled(writes);
    localStorage.setItem("courrier-last-fetch", String(Date.now()));
    console.log(`[Courrier] ✅ ${allItems.length} articles synchronisés avec Firestore.`);

  } catch (err) {
    console.error("[Courrier] Erreur de synchronisation RSS :", err);
  } finally {
    fetchInProgress = false;
  }
}

// ----------------------------------------------------------------
//  CONSTRUCTION D'UNE CARTE ARTICLE
// ----------------------------------------------------------------
function buildArticleCard(id, data) {
  const cat     = CAT_COLORS[data.categorie] ?? DEFAULT_CAT;
  const dateStr = formatDate(data.date);

  const card = document.createElement("article");
  card.className = "courrier-card";
  card.setAttribute("data-id", id);
  card.setAttribute("data-cat", data.categorie ?? "");

  card.innerHTML = `
    ${data.imageUrl ? `
    <div class="courrier-card__img-wrap">
      <img class="courrier-card__img"
           src="${esc(data.imageUrl)}"
           alt="${esc(data.titre)}"
           loading="lazy"
           onerror="this.closest('.courrier-card__img-wrap').style.display='none'" />
      <span class="courrier-card__cat-badge" style="background:${cat.bg}">
        <span class="material-symbols-outlined">${cat.icon}</span>
        ${esc(data.categorie ?? "Monde")}
      </span>
    </div>` : `
    <div class="courrier-card__no-img" style="background:${cat.bg}">
      <span class="material-symbols-outlined">${cat.icon}</span>
      <span class="courrier-card__cat-badge courrier-card__cat-badge--inline">
        ${esc(data.categorie ?? "Monde")}
      </span>
    </div>`}

    <div class="courrier-card__body">
      <div class="courrier-card__meta">
        <span class="courrier-source-badge">
          <span class="material-symbols-outlined">newspaper</span>
          ${esc(data.source ?? "Presse")}
        </span>
        <span class="courrier-date">${esc(dateStr)}</span>
      </div>

      <h3 class="courrier-card__title">${esc(data.titre)}</h3>

      ${data.resume ? `<p class="courrier-card__summary">${esc(data.resume)}</p>` : ""}

      ${data.url ? `
      <a class="courrier-card__link" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">
        <span class="material-symbols-outlined">open_in_new</span>
        Lire l'article complet
      </a>` : ""}
    </div>
  `;

  return card;
}

// ----------------------------------------------------------------
//  ÉCOUTE TEMPS RÉEL — onSnapshot Firestore
// ----------------------------------------------------------------
function startListening() {
  if (unsubscribeCourrier) unsubscribeCourrier();

  const feed = $("courrier-feed");
  if (!feed) return;

  showSkeletons(feed, 5, "courrier-skeleton");

  const q = query(
    collection(db, "courrier_news"),
    orderBy("date", "desc"),
    limit(60)
  );

  unsubscribeCourrier = onSnapshot(q,
    (snap) => {
      const feed = $("courrier-feed");
      if (!feed) return;
      feed.innerHTML = "";

      if (snap.empty) {
        // Collection vide → force un fetch RSS immédiat
        showEmptyState(feed, "newspaper", "⏳ Chargement des articles en cours… Patiente quelques secondes !");
        syncFeedsToFirestore(true);
        return;
      }

      snap.docs.forEach((docSnap) => {
        const card = buildArticleCard(docSnap.id, docSnap.data());
        feed.appendChild(card);
      });

      applyFilter(currentFilter);
    },
    (err) => {
      console.error("Erreur Firestore courrier :", err);
      const feed = $("courrier-feed");
      showEmptyState(feed, "error", "Impossible de charger les articles.<br>Vérifie ta connexion.");
    }
  );
}

// ----------------------------------------------------------------
//  FILTRE PAR CATÉGORIE (client-side)
// ----------------------------------------------------------------
function applyFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll(".courrier-card").forEach((card) => {
    const cat = card.dataset.cat ?? "";
    card.style.display = (filter === "tous" || cat === filter) ? "" : "none";
  });
}

// ----------------------------------------------------------------
//  CÂBLAGE DES FILTRES (une seule fois)
// ----------------------------------------------------------------
function wireFilters() {
  if (filtersWired) return;
  filtersWired = true;

  document.querySelectorAll(".courrier-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".courrier-filter-btn").forEach((b) => {
        b.classList.toggle("filter-btn--active",   b === btn);
        b.classList.toggle("filter-btn--inactive", b !== btn);
      });
      applyFilter(btn.dataset.cat);
    });
  });
}

// ----------------------------------------------------------------
//  EXPORTS
// ----------------------------------------------------------------
export function initCourrier() {
  wireFilters();
  window.clearBadge?.("courrier");

  // Réinitialise le filtre à "tous" à chaque ouverture
  currentFilter = "tous";
  document.querySelectorAll(".courrier-filter-btn").forEach((b) => {
    b.classList.toggle("filter-btn--active",   b.dataset.cat === "tous");
    b.classList.toggle("filter-btn--inactive", b.dataset.cat !== "tous");
  });

  // Lance l'écoute Firestore immédiatement (cache hors-ligne si dispo)
  startListening();

  // Lance la synchro RSS en arrière-plan
  // Force le refresh si la page vient d'être ouverte (TTL ignoré sur premier appel)
  syncFeedsToFirestore();
}

export function destroyCourrier() {
  if (unsubscribeCourrier) { unsubscribeCourrier(); unsubscribeCourrier = null; }
}
