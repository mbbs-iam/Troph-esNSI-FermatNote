// ================================================================
//  matieres.js — Liste officielle des matières
//  Lycée Skillforge · Hub de Classe
//  ----------------------------------------------------------------
//  SOURCE UNIQUE de vérité pour les matières de l'application.
//  Importée par : devoirs.js, forum.js
//  Utilisée par : index.html (sélects + boutons de tag)
//
//  Ordre : du plus demandé au moins demandé (Focus Fermat)
// ================================================================

export const MATIERES = [
  {
    id:    "mathematiques",
    label: "Mathématiques",
    short: "Maths",
    emoji: "📐",
    color: "#3B82F6",   // bleu
    icon:  "calculate",
  },
  {
    id:    "physique-chimie",
    label: "Physique-Chimie",
    short: "Physique",
    emoji: "⚗️",
    color: "#F97316",   // orange
    icon:  "science",
  },
  {
    id:    "svt",
    label: "SVT",
    short: "SVT",
    emoji: "🌿",
    color: "#22C55E",   // vert
    icon:  "biotech",
  },
  {
    id:    "ses",
    label: "SES",
    short: "SES",
    emoji: "📊",
    color: "#8B5CF6",   // violet
    icon:  "trending_up",
  },
  {
    id:    "histoire-geo",
    label: "Histoire-Géo / HGGSP",
    short: "Hist-Géo",
    emoji: "🌍",
    color: "#F43F5E",   // rose
    icon:  "public",
  },
  {
    id:    "francais",
    label: "Français / Philo / HLP",
    short: "Français",
    emoji: "📖",
    color: "#F59E0B",   // ambre
    icon:  "menu_book",
  },
  {
    id:    "anglais",
    label: "Anglais (LV1)",
    short: "Anglais",
    emoji: "🌐",
    color: "#06B6D4",   // cyan
    icon:  "language",
  },
  {
    id:    "nsi",
    label: "NSI",
    short: "NSI",
    emoji: "💻",
    color: "#6366F1",   // indigo
    icon:  "terminal",
  },
  {
    id:    "si",
    label: "Sciences de l'Ingénieur",
    short: "SI",
    emoji: "⚙️",
    color: "#14B8A6",   // teal
    icon:  "engineering",
  },
  {
    id:    "lv2",
    label: "Espagnol / Allemand (LV2)",
    short: "LV2",
    emoji: "💬",
    color: "#EC4899",   // rose foncé
    icon:  "translate",
  },
  {
    id:    "arts",
    label: "Arts / Littérature",
    short: "Arts",
    emoji: "🎨",
    color: "#D946EF",   // fuchsia
    icon:  "palette",
  },
];

// ----------------------------------------------------------------
//  HELPERS
// ----------------------------------------------------------------

/**
 * Trouve une matière par correspondance souple sur le label ou l'id.
 * @param {string} label
 * @returns {object|null}
 */
export function getMatiereInfo(label) {
  if (!label) return null;
  const l = label.toLowerCase().trim();

  // 1. Correspondance exacte sur le label stocké
  const exact = MATIERES.find(m => m.label.toLowerCase() === l);
  if (exact) return exact;

  // 2. Correspondance partielle (id, short, premiers mots)
  return MATIERES.find(m => {
    if (l.includes(m.id))           return true;
    if (l.includes(m.short.toLowerCase())) return true;
    // Vérifie si le premier mot du label (>3 chars) est dans la chaîne
    const first = m.label.toLowerCase().split(" ")[0];
    return first.length > 3 && l.includes(first);
  }) ?? null;
}

/** Couleur hex de la matière (défaut vert Fermat) */
export function getMatiereColor(label) {
  return getMatiereInfo(label)?.color ?? "#10B981";
}

/** Icône Material Symbols de la matière */
export function getMatiereIcon(label) {
  return getMatiereInfo(label)?.icon ?? "assignment";
}

/** Emoji de la matière */
export function getMatiereEmoji(label) {
  return getMatiereInfo(label)?.emoji ?? "📝";
}

/**
 * Génère les <option> HTML pour un <select>.
 * Usage : selectEl.innerHTML = buildMatiereOptions();
 */
export function buildMatiereOptions() {
  return MATIERES
    .map(m => `<option value="${m.label}">${m.emoji} ${m.label}</option>`)
    .join("\n");
}
