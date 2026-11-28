/* Capsule Passage : motion design, deux formats (16:9 et 9:16).
 *
 * Principe : animation DÉTERMINISTE. Rien ne bouge tout seul ; rendre.mjs appelle
 * afficher(t) pour chaque image (30 par seconde) et photographie la page. Chaque
 * élément animé porte une liste de segments [début, fin, {propriété: [de, à]}, courbe].
 * Les captures viennent de ../../captures (prises sur l'application en marche).
 */
/* global ICONES */
'use strict';

// ---------- Courbes d'animation ----------
const COURBES = {
  lin: (p) => p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  inout: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  in: (p) => p * p * p,
  rebond: (p) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  },
  elastique: (p) =>
    p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1,
};

// ---------- Moteur ----------
const PISTES = []; // { el, segments }
const PLANS = []; // { el, debut, fin }
let W = 1920;
let H = 1080;
let V = false; // format vertical ?
const CAPTURES = '../../captures/';

/** Valeurs des propriétés d'un élément à l'instant t. */
function valeurs(segments, t) {
  const v = {};
  for (const [a, b, props, courbe = 'out'] of segments) {
    for (const k in props) {
      const [de, a2] = props[k];
      if (t < a) {
        if (!(k in v)) v[k] = de;
      } else {
        const p = b > a ? Math.min(1, (t - a) / (b - a)) : 1;
        v[k] = de + (a2 - de) * COURBES[courbe](p);
      }
    }
  }
  return v;
}

function appliquer(el, v) {
  const tr = [];
  if ('x' in v || 'y' in v) tr.push(`translate(${v.x ?? 0}px, ${v.y ?? 0}px)`);
  if ('ry' in v || 'rx' in v) tr.push(`perspective(1400px) rotateY(${v.ry ?? 0}deg) rotateX(${v.rx ?? 0}deg)`);
  if ('r' in v) tr.push(`rotate(${v.r}deg)`);
  if ('s' in v) tr.push(`scale(${v.s})`);
  if (tr.length) el.style.transform = tr.join(' ');
  if ('o' in v) el.style.opacity = v.o;
  if ('flou' in v) el.style.filter = v.flou > 0.05 ? `blur(${v.flou}px)` : 'none';
  if ('trace' in v) el.style.setProperty('--trace', v.trace);
  if ('cercle' in v) el.style.clipPath = `circle(${v.cercle}% at 50% 50%)`;
  if ('nombre' in v) el.textContent = Math.round(v.nombre);
  if ('lettres' in v) el.textContent = el.dataset.texte.slice(0, Math.round(v.lettres));
  if ('largeur' in v) el.style.width = v.largeur + '%';
  if ('lueur' in v) el.style.boxShadow = `0 0 ${v.lueur}px ${v.lueur / 3}px rgba(230,168,101,${Math.min(0.9, v.lueur / 60)})`;
}

/** Enregistre une animation ; les temps sont relatifs au début du plan (T0). */
let T0 = 0;
function anim(el, segments) {
  PISTES.push({ el, segments: segments.map(([a, b, p, c]) => [a + T0, b + T0, p, c]) });
  return el;
}

// ---------- Fabrique d'éléments ----------
function el(tag, classe, parent, style = {}) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
const px = (n) => `${n}px`;
const pos = (x, y, w, h) => ({ left: px(x), top: px(y), ...(w ? { width: px(w) } : {}), ...(h ? { height: px(h) } : {}) });

/** Pictogramme Lucide en SVG, tracé animable (propriété « trace » de 1 à 0). */
function icone(nom, taille, couleur = '#fff', epaisseur = 2) {
  if (!ICONES[nom]) throw new Error(`Icône inconnue : ${nom}`);
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', taille);
  s.setAttribute('height', taille);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', couleur);
  s.setAttribute('stroke-width', epaisseur);
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('class', 'trace');
  for (const [tag, attrs] of ICONES[nom]) {
    const f = document.createElementNS(ns, tag);
    for (const k in attrs) f.setAttribute(k, attrs[k]);
    f.setAttribute('pathLength', '1');
    s.appendChild(f);
  }
  return s;
}

/** Pastille animée : apparaît en rebondissant, puis son pictogramme se dessine. */
function pastille(parent, nom, x, y, taille, t, variante = '') {
  const p = el('div', `abs pastille ${variante}`, parent, pos(x, y, taille, taille));
  const svg = icone(nom, taille * 0.52, variante === 'claire' ? '#84411a' : '#fff');
  p.appendChild(svg);
  anim(p, [[t, t + 0.55, { s: [0, 1], o: [0, 1], r: [-12, 0] }, 'rebond']]);
  anim(svg, [[t + 0.15, t + 0.85, { trace: [1, 0] }, 'inout']]);
  return p;
}

/** Titre cinétique : les mots arrivent un à un, du flou vers le net. */
function titre(parent, lignes, x, y, taille, t, { centre = false, largeur = null } = {}) {
  const b = el('div', 'abs titre', parent, { ...pos(x, y), fontSize: px(taille), textAlign: centre ? 'center' : 'left', width: largeur ? px(largeur) : 'auto' });
  let i = 0;
  lignes.forEach((ligne, k) => {
    const l = el('div', '', b);
    for (const mot of ligne.split(' ')) {
      const accent = mot.startsWith('*');
      const m = el('span', `mot${accent ? ' accent' : ''}`, l);
      m.textContent = accent ? mot.slice(1) : mot;
      anim(m, [[t + i * 0.07, t + i * 0.07 + 0.55, { o: [0, 1], y: [34, 0], flou: [12, 0] }]]);
      i++;
    }
    if (k < lignes.length - 1) el('div', '', b);
  });
  return b;
}

function puce(parent, texte, nomIcone, x, y, taille, t, couleur = '#84411a') {
  const p = el('div', 'abs puce', parent, { ...pos(x, y), fontSize: px(taille) });
  const i = icone(nomIcone, taille * 1.25, couleur, 2.4);
  p.appendChild(i);
  el('span', '', p).textContent = texte;
  anim(p, [[t, t + 0.5, { o: [0, 1], x: [-40, 0], s: [0.9, 1] }, 'rebond']]);
  anim(i, [[t + 0.2, t + 0.8, { trace: [1, 0] }]]);
  return p;
}

/** Téléphone avec plusieurs écrans superposés (fondu de l'un à l'autre). */
function telephone(parent, x, y, largeur, images) {
  const h = Math.round(largeur * (2402 / 1082)) + 24;
  const tel = el('div', 'abs telephone', parent, pos(x, y, largeur + 24, h));
  const ecran = el('div', 'ecran', tel);
  const imgs = images.map((src, i) => {
    const im = el('img', '', ecran, { opacity: i === 0 ? 1 : 0 });
    im.src = CAPTURES + src;
    return im;
  });
  el('div', 'encoche', tel);
  return { tel, ecran, imgs, h };
}
function changerEcran(t, imgs, de, vers, duree = 0.35) {
  anim(imgs[vers], [[t, t + duree, { o: [0, 1] }, 'lin']]);
  if (de !== null) anim(imgs[de], [[t + duree, t + duree + 0.01, { o: [1, 0] }, 'lin']]);
}

/** Badge NFC illustré : non nominatif (aucun nom d'élève). */
function badge(parent, x, y, largeur, t) {
  const h = Math.round(largeur * 0.63);
  const b = el('div', 'abs badge', parent, pos(x, y, largeur, h));
  el('div', 'puce-or', b, pos(largeur * 0.1, h * 0.3, largeur * 0.16, h * 0.26));
  const nfc = icone('nfc', largeur * 0.2, '#fff', 2.2);
  Object.assign(nfc.style, { position: 'absolute', right: px(largeur * 0.08), top: px(h * 0.1) });
  b.appendChild(nfc);
  const nom = el('div', '', b, { position: 'absolute', left: px(largeur * 0.1), bottom: px(h * 0.12), fontWeight: 800, fontSize: px(largeur * 0.085) });
  nom.textContent = 'Passage';
  const reflet = el('div', 'reflet', b);
  anim(reflet, [[t + 0.4, t + 1.6, { x: [-largeur, largeur] }, 'inout']]);
  return b;
}

/** Ondes concentriques (contact NFC, éclats). */
function ondes(parent, cx, cy, rayon, t, n = 3, couleur = null) {
  for (let i = 0; i < n; i++) {
    const o = el('div', 'abs onde', parent, pos(cx - rayon, cy - rayon, rayon * 2, rayon * 2));
    if (couleur) o.style.borderColor = couleur;
    anim(o, [
      [t + i * 0.22, t + i * 0.22 + 1.1, { s: [0.2, 1.6], o: [0.9, 0] }, 'out'],
    ]);
  }
}

/** Entrée du plan : chaque scène a sa transition. */
function transition(plan, type, debut) {
  T0 = debut;
  if (type === 'cercle') anim(plan, [[0, 0.75, { cercle: [0, 150] }, 'inout']]);
  else if (type === 'glisse') anim(plan, [[0, 0.7, { x: [V ? 0 : W, 0], y: [V ? H : 0, 0] }, 'inout']]);
  else if (type === 'zoom') anim(plan, [[0, 0.7, { s: [1.25, 1], o: [0, 1], flou: [18, 0] }, 'out']]);
  else if (type === 'fondu') anim(plan, [[0, 0.6, { o: [0, 1] }, 'lin']]);
}
function sortie(plan, fin) {
  T0 = fin - 0.6;
  anim(plan, [[0, 0.6, { s: [1, 1.08], flou: [0, 10] }, 'in']]);
}

// ---------- Fond animé ----------
function fond(scene) {
  const motif = el('div', 'motif', scene);
  const halos = [
    ['#d9883a', 0.35, 0.3, 700],
    ['#b83a2e', 0.7, 0.75, 800],
    ['#84411a', 0.15, 0.85, 600],
  ].map(([c, fx, fy, r]) => ({ e: el('div', 'halo', scene, { ...pos(W * fx - r / 2, H * fy - r / 2, r, r), background: c, opacity: 0.22 }), fx, fy, r }));
  // Particules : trajectoires pseudo-aléatoires mais fixes (graine).
  let graine = 7;
  const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  const parts = Array.from({ length: V ? 34 : 42 }, () => {
    const t = 2 + alea() * 6;
    return { e: el('div', 'particule', scene, { width: px(t), height: px(t) }), x: alea() * W, y: alea() * H, v: 12 + alea() * 30, p: alea() * 6 };
  });
  const plans = el('div', 'plan', scene);
  el('div', 'grain', scene);
  el('div', 'vignette', scene);
  return {
    plans,
    animer(t) {
      motif.style.transform = `translate(${(t * 14) % 340}px, ${(t * 7) % 340}px)`;
      for (const h of halos) {
        h.e.style.transform = `translate(${Math.sin(t * 0.4 + h.fx * 6) * 120}px, ${Math.cos(t * 0.33 + h.fy * 5) * 90}px)`;
      }
      for (const q of parts) {
        const y = (((q.y - q.v * t) % H) + H) % H;
        const x = q.x + Math.sin(t * 0.8 + q.p) * 30;
        q.e.style.transform = `translate(${x}px, ${y}px)`;
        q.e.style.opacity = 0.25 + 0.35 * Math.abs(Math.sin(t * 1.3 + q.p));
      }
    },
  };
}

// ---------- Les scènes ----------
// Chaque fonction reçoit le plan (calque), sa durée d et construit ses animations
// (temps relatifs au début du plan).
const SCENES = {
  intro(p) {
    const L = V ? 300 : 280;
    const cx = W / 2 - L / 2;
    const cy = V ? 560 : 170;
    ondes(p, W / 2, cy + L / 2, L * 0.7, 0.2, 3);
    const logo = el('div', 'abs', p, { ...pos(cx, cy, L, L) });
    logo.innerHTML = `<svg viewBox="0 0 512 512" width="${L}" height="${L}"><rect width="512" height="512" rx="112" fill="#84411a"/><path class="p" d="M168 360V152h104a64 64 0 0 1 0 128h-56" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:var(--trace,0)"/><circle cx="344" cy="344" r="28" fill="#e6a865"/></svg>`;
    anim(logo, [[0, 0.7, { s: [0, 1], r: [-20, 0] }, 'rebond']]);
    anim(logo.querySelector('svg'), [[0.35, 1.2, { trace: [1, 0] }, 'inout']]);
    anim(logo.querySelector('circle'), [[1.1, 1.5, { s: [0, 1] }, 'rebond']]);
    logo.querySelector('circle').style.transformOrigin = '344px 344px';
    titre(p, ['Passage'], 0, cy + L + 50, V ? 150 : 140, 0.9, { centre: true, largeur: W });
    titre(p, ['Mon enfant est-il bien arrivé ?'], 0, cy + L + (V ? 240 : 220), V ? 54 : 52, 1.5, { centre: true, largeur: W }).style.color = '#f1cba0';
  },

  questions(p, d) {
    const qs = [
      ['school', ['Bien arrivé', "à *l'école ?"]],
      ['bus', ['Monté', 'dans le *bus ?']],
      ['door-open', ['Sorti', "à *l'heure ?"]],
    ];
    const taille = V ? 74 : 72;
    qs.forEach(([ic, lignes], i) => {
      const t = 0.2 + (i * (d - 1)) / 3;
      const x = V ? 110 : 160 + i * 560;
      const y = V ? 330 + i * 380 : 330;
      pastille(p, ic, x, y, V ? 170 : 160, t);
      const tt = titre(p, lignes, V ? x + 210 : x, V ? y + 10 : y + 200, taille, t + 0.3);
      // Les questions déjà posées s'estompent quand la suivante arrive.
      if (i < 2) anim(tt, [[(i + 1) * ((d - 1) / 3) + 0.2, (i + 1) * ((d - 1) / 3) + 0.7, { o: [1, 0.45] }, 'lin']]);
    });
    const q = el('div', 'abs titre', p, { ...pos(V ? 640 : 1500, V ? 1250 : 600), fontSize: px(V ? 420 : 380), opacity: 0.08 });
    q.textContent = '?';
    anim(q, [[0, d, { r: [-8, 10], y: [30, -30] }, 'lin']]);
  },

  solution(p, d) {
    const lt = V ? 470 : 360;
    const tx = V ? W / 2 - lt / 2 - 12 : 1180;
    const ty = V ? 470 : 70;
    const { tel, imgs } = telephone(p, tx, ty, lt, ['04c-agent-synchronise.png', '03b-agent-badge-accepte.png']);
    anim(tel, [[0, 0.9, { x: [400, 0], ry: [-35, 0], o: [0, 1] }, 'out'], [0.9, d, { ry: [0, -6], y: [0, -10] }, 'inout']]);
    const bl = V ? 330 : 300;
    const b = badge(p, V ? 60 : 600, V ? 1380 : 560, bl, 1.0);
    const cible = V ? { x: tx + lt / 2 - bl / 2 - 60, y: ty + 420 } : { x: tx - bl * 0.55, y: ty + 330 };
    anim(b, [
      [0.8, 1.4, { o: [0, 1], s: [0.6, 1], r: [-25, -12] }, 'rebond'],
      [1.6, 2.4, { x: [0, cible.x - (V ? 60 : 600)], y: [0, cible.y - (V ? 1380 : 560)], r: [-12, 6] }, 'inout'],
      [2.9, 3.5, { x: [cible.x - (V ? 60 : 600), cible.x - (V ? 60 : 600) - 140], o: [1, 0] }, 'in'],
    ]);
    ondes(p, cible.x + bl * 0.85, cible.y + bl * 0.3, 90, 2.35, 3);
    changerEcran(2.6, imgs, 0, 1);
    const eclat = el('div', 'abs', p, { ...pos(tx, ty, lt + 24, lt * 2.22 + 24), borderRadius: px(54), background: 'radial-gradient(circle, rgba(5,150,105,0.6), transparent 70%)' });
    anim(eclat, [[2.6, 3.4, { o: [0, 0.9], s: [0.8, 1.15] }, 'out'], [3.4, 4.2, { o: [0.9, 0] }, 'lin']]);
    ondes(p, tx + lt / 2, ty + lt * 0.75, 120, 2.7, 2, '#059669');
    pastille(p, 'circle-check', V ? tx + lt - 40 : tx - 110, V ? ty - 70 : ty + 520, V ? 150 : 140, 2.9, 'verte');
    titre(p, ['La réponse', 'en *une *seconde'], V ? 80 : 140, V ? 150 : 300, V ? 82 : 86, 0.3);
  },

  eleve(p, d) {
    const bl = V ? 640 : 620;
    const bx = V ? W / 2 - bl / 2 : 1060;
    const by = V ? 820 : 300;
    const b = badge(p, bx, by, bl, 0.3);
    anim(b, [[0, 0.8, { o: [0, 1], s: [0.5, 1], ry: [70, -14] }, 'rebond'], [0.8, d, { ry: [-14, 14], rx: [6, -6] }, 'inout']]);
    ondes(p, bx + bl * 0.85, by + bl * 0.15, 80, 1.0, 3);
    titre(p, ['Juste un badge,', 'et *un *geste'], V ? 80 : 140, V ? 160 : 250, V ? 80 : 84, 0.2);
    const items = [
      ['smartphone', 'Pas de téléphone'],
      ['key-round', 'Pas de mot de passe'],
    ];
    items.forEach(([ic, txt], i) => {
      const t = 1.2 + i * 0.9;
      const x = V ? 120 + i * 0 : 140;
      const y = V ? 470 + i * 140 : 560 + i * 150;
      const pu = puce(p, txt, ic, x, y, V ? 44 : 42, t);
      // Barre rouge qui raye l'icône.
      const barre = el('div', 'abs', pu, { left: px(14), top: px(V ? 44 : 42), width: px(V ? 64 : 60), height: px(6), background: '#dc2626', borderRadius: px(3), transformOrigin: 'left center' });
      barre.style.position = 'absolute';
      barre.style.transform = 'rotate(-35deg) scaleX(0)';
      anim(barre, [[t + 0.6, t + 0.9, { r: [-35, -35], s: [0, 1] }, 'out']]);
      pu.style.position = 'absolute';
    });
  },

  agent(p, d) {
    const lt = V ? 450 : 350;
    const tx = V ? W / 2 - lt / 2 - 12 : 1200;
    const ty = V ? 540 : 70;
    const { tel, imgs } = telephone(p, tx, ty, lt, ['04c-agent-synchronise.png', '04a-agent-hors-ligne.png', '04b-agent-4-en-attente.png', '04c-agent-synchronise.png']);
    anim(tel, [[0, 0.8, { y: [300, 0], o: [0, 1], rx: [20, 0] }, 'out']]);
    titre(p, ['Et si le réseau', '*coupe ?'], V ? 80 : 140, V ? 150 : 200, V ? 82 : 86, 0.2);
    const tc = d * 0.22;
    const tr = d * 0.62;
    // Réseau : Wi-Fi qui se coupe, puis revient.
    const px0 = V ? 80 : 160;
    const py0 = V ? 340 : 560;
    const wifi = pastille(p, 'wifi', px0, py0, V ? 130 : 150, 0.4);
    const wifiOff = pastille(p, 'wifi-off', px0, py0, V ? 130 : 150, tc, 'rouge');
    anim(wifi, [[tc, tc + 0.2, { o: [1, 0] }, 'lin']]);
    anim(wifiOff, [[tc + 0.5, tc + 0.9, { r: [0, -8] }, 'elastique'], [tr, tr + 0.2, { o: [1, 0] }, 'lin']]);
    const wifi2 = pastille(p, 'refresh-cw', px0, py0, V ? 130 : 150, tr, 'verte');
    anim(wifi2.firstChild, [[tr + 0.2, tr + 1.6, { r: [0, 360] }, 'inout']]);
    changerEcran(tc + 0.1, imgs, 0, 1);
    changerEcran(tc + 1.3, imgs, 1, 2);
    changerEcran(tr + 0.8, imgs, 2, 3);
    // Compteur « en attente » qui monte, puis redescend à l'envoi.
    const bulle = el('div', 'abs tuile', p, { ...pos(V ? 240 : 520, V ? 330 : 560, V ? 280 : 360, V ? 150 : 200), padding: V ? '14px' : '22px' });
    const n = el('div', 'n', bulle, { fontSize: px(V ? 76 : 100), color: '#a2541c' });
    el('div', '', bulle, { fontSize: px(30), fontWeight: 700 }).textContent = 'en attente';
    anim(bulle, [[tc + 0.4, tc + 0.9, { o: [0, 1], s: [0.6, 1] }, 'rebond']]);
    anim(n, [[tc + 0.6, tr - 0.4, { nombre: [0, 4] }, 'lin'], [tr + 0.5, tr + 1.4, { nombre: [4, 0] }, 'inout']]);
    // Envoi : points qui filent du téléphone vers le serveur.
    for (let i = 0; i < 8; i++) {
      const pt = el('div', 'abs particule', p, { ...pos(tx + lt / 2, ty + 200, 16, 16), background: '#6ee7b7' });
      const dx = V ? 0 : -500;
      const dy = V ? -380 : 0;
      anim(pt, [[tr + 0.4 + i * 0.1, tr + 1.2 + i * 0.1, { x: [0, dx], y: [0, dy], o: [1, 0], s: [1.4, 0.4] }, 'in']]);
    }
    puce(p, "Rien n'est perdu", 'check', V ? 560 : 140, V ? 370 : 800, V ? 38 : 42, tr + 1.2, '#059669');
  },

  parents(p, d) {
    const lt = V ? 450 : 350;
    const tx = V ? W / 2 - lt / 2 - 12 : 1200;
    const ty = V ? 540 : 70;
    const { tel } = telephone(p, tx, ty, lt, ['05a-parent-enfants.png']);
    anim(tel, [[0, 0.8, { x: [V ? 0 : 300, 0], o: [0, 1], ry: [25, 0] }, 'out']]);
    titre(p, ["Pas passé", "à *l'heure ?"], V ? 80 : 140, V ? 150 : 200, V ? 82 : 86, 0.2);
    // Notification qui tombe sur l'écran du parent.
    const nw = V ? 900 : 760;
    const notif = el('div', 'abs notif', p, { ...pos(V ? 90 : 560, V ? 760 : 380, nw), fontSize: px(V ? 34 : 30) });
    const cloche = el('div', 'pastille', notif, { width: px(84), height: px(84), flex: 'none' });
    const ic = icone('bell-ring', 44, '#fff');
    cloche.appendChild(ic);
    const txt = el('div', '', notif);
    el('div', 't', txt).textContent = 'Passage · maintenant';
    el('div', '', txt).textContent = 'Aucun passage enregistré pour Awa au portail de sortie entre 15:30 et 16:15.';
    const tn = 1.0;
    anim(notif, [[tn, tn + 0.8, { y: [-500, 0], o: [0, 1] }, 'elastique']]);
    anim(cloche, [[tn + 0.6, tn + 1.4, { r: [0, 0] }, 'lin']]);
    anim(ic, [[tn + 0.6, tn + 1.4, { r: [-25, 0] }, 'elastique'], [tn + 0.3, tn + 1.0, { trace: [1, 0] }]]);
    // Confidentialité : chaque parent ne voit que ses enfants.
    const t2 = d * 0.55;
    puce(p, 'Seulement ses enfants', 'lock', V ? 80 : 140, V ? 360 : 800, V ? 40 : 42, t2);
    pastille(p, 'shield-check', V ? 840 : 960, V ? 120 : 760, V ? 130 : 140, t2 + 0.3, 'verte');
  },

  exceptions(p, d) {
    titre(p, ['Férié, absence,', '*sortie *autorisée ?'], V ? 80 : 140, V ? 170 : 180, V ? 78 : 80, 0.2);
    pastille(p, 'calendar-check', V ? W / 2 - 110 : 1380, V ? 600 : 220, V ? 220 : 240, 0.4);
    const items = ['Jour férié', 'Absence justifiée', 'Sortie autorisée'];
    items.forEach((txt, i) => puce(p, txt, 'circle-check', V ? 170 : 140, (V ? 920 : 470) + i * (V ? 140 : 130), V ? 46 : 42, 0.9 + i * 0.45, '#059669'));
    const t2 = d * 0.6;
    const bo = pastille(p, 'bell-off', V ? W / 2 - 80 : 1430, V ? 1330 : 560, 160, t2, 'claire');
    anim(bo, [[t2 + 0.5, t2 + 1.1, { r: [0, 0] }, 'lin']]);
    puce(p, "Pas d'alerte inutile", 'check', V ? 260 : 1130, V ? 1520 : 780, V ? 42 : 40, t2 + 0.4);
  },

  copie(p, d) {
    const lt = V ? 450 : 350;
    const tx = V ? W / 2 - lt / 2 - 12 : 1200;
    const ty = V ? 540 : 70;
    const { tel, imgs } = telephone(p, tx, ty, lt, ['04c-agent-synchronise.png', '06-agent-photo-refusee.png']);
    anim(tel, [[0, 0.7, { o: [0, 1], s: [0.9, 1] }, 'out']]);
    titre(p, ['Et si quelqu’un', '*copie le badge ?'], V ? 80 : 140, V ? 150 : 200, V ? 80 : 84, 0.2);
    const bl = V ? 300 : 280;
    const bx = V ? 90 : 300;
    const by = V ? 1420 : 560;
    badge(p, bx, by, bl, 0.2);
    // Flash d'appareil photo (effet), puis la copie part vers le téléphone.
    pastille(p, 'camera', bx + bl - 60, by - 90, 110, 0.5);
    const flash = el('div', 'flash', p);
    anim(flash, [[0.9, 0.95, { o: [0, 0.9] }, 'lin'], [0.95, 1.4, { o: [0.9, 0] }, 'out']]);
    flash.style.opacity = 0;
    const copie = badge(p, bx, by, bl, 99);
    copie.style.filter = 'grayscale(0.6)';
    copie.style.outline = '6px dashed #f1cba0';
    const cx = V ? tx + lt / 2 - bl / 2 : tx - bl * 0.5;
    const cy = V ? ty + 360 : ty + 330;
    anim(copie, [[1.2, 1.3, { o: [0, 0.85] }, 'lin'], [1.3, 2.1, { x: [0, cx - bx], y: [0, cy - by], r: [0, 8] }, 'inout'], [2.6, 3.0, { o: [0.85, 0], s: [1, 0.6] }, 'in']]);
    changerEcran(2.2, imgs, 0, 1, 0.2);
    const rouge = el('div', 'abs', p, { inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, rgba(220,38,38,0.45))' });
    rouge.style.opacity = 0;
    anim(rouge, [[2.2, 2.4, { o: [0, 1] }, 'lin'], [2.4, 3.4, { o: [1, 0] }, 'out']]);
    const tampon = el('div', 'abs tampon', p, { ...pos(V ? W / 2 - 230 : 520, V ? 1180 : 420), fontSize: px(V ? 84 : 80) });
    tampon.textContent = 'REFUSÉE';
    anim(tampon, [[2.3, 2.6, { o: [0, 1], s: [2.4, 1], r: [-14, -8] }, 'in'], [2.6, 3.0, { x: [-8, 0] }, 'elastique']]);
    pastille(p, 'bell-ring', V ? 840 : 960, V ? 120 : 760, V ? 130 : 120, d * 0.6, 'rouge');
    puce(p, "L'école est alertée", 'shield-check', V ? 80 : 140, V ? 360 : 800, V ? 40 : 40, d * 0.6 + 0.2, '#dc2626');
  },

  synthese(p, d) {
    titre(p, ['Qui est là', "*aujourd'hui ?"], V ? 80 : 140, V ? 150 : 120, V ? 84 : 84, 0.2);
    const tuiles = [
      ['Présents', 11, '#059669'],
      ['En retard', 1, '#d9883a'],
      ['Passage manquant', 1, '#dc2626'],
    ];
    const tw = V ? 290 : 330;
    tuiles.forEach(([lib, n, c], i) => {
      const x = V ? 60 + i * (tw + 25) : 140 + i * (tw + 30);
      const y = V ? 500 : 360;
      const tu = el('div', 'abs tuile', p, { ...pos(x, y, tw, V ? 250 : 230), padding: '28px 16px' });
      const nb = el('div', 'n', tu, { fontSize: px(V ? 110 : 110), color: c });
      el('div', '', tu, { fontSize: px(V ? 30 : 30), fontWeight: 700, marginTop: '10px' }).textContent = lib;
      const t = 0.8 + i * 0.3;
      anim(tu, [[t, t + 0.6, { o: [0, 1], y: [60, 0], s: [0.85, 1] }, 'rebond']]);
      anim(nb, [[t + 0.2, t + 1.4, { nombre: [0, n] }, 'out']]);
    });
    // La synthèse rédigée par le modèle, à partir des chiffres calculés.
    const cw = V ? 960 : 900;
    const carte = el('div', 'abs fenetre', p, { ...pos(V ? 60 : 140, V ? 820 : 600, cw) });
    const img = el('img', '', carte, { width: '100%', display: 'block' });
    img.src = CAPTURES + '07-responsable-synthese.png';
    anim(carte, [[d * 0.35, d * 0.35 + 0.7, { o: [0, 1], y: [80, 0] }, 'out']]);
    const t2 = d * 0.5;
    pastille(p, 'sparkles', V ? 80 : 1280, V ? 1200 : 380, 140, t2);
    puce(p, "L'IA rédige", 'sparkles', V ? 250 : 1420, V ? 1210 : 400, V ? 40 : 38, t2 + 0.3);
    puce(p, 'Le système compte', 'chart-column', V ? 80 : 1250, V ? 1360 : 560, V ? 40 : 38, t2 + 0.9, '#059669');
  },

  partenaires(p, d) {
    titre(p, ['Et pour les', '*partenaires ?'], V ? 80 : 140, V ? 150 : 150, V ? 84 : 86, 0.2);
    const fw = V ? 960 : 1000;
    const fh = V ? 560 : 560;
    const f = el('div', 'abs fenetre', p, pos(V ? 60 : 820, V ? 470 : 280, fw, fh));
    el('div', 'barre', f).append(el('i'), el('i'), el('i'));
    const vue = el('div', 'vue', f, { height: px(fh - 44) });
    const img = el('img', '', vue);
    img.src = CAPTURES + '08-responsable-journee.png';
    anim(f, [[0.3, 1.1, { o: [0, 1], ry: [-25, 0], x: [120, 0] }, 'out']]);
    anim(img, [[0.6, d, { y: [0, -(fw * 0.5625 - (fh - 44)) - 40], s: [1, 1.04] }, 'inout']]);
    const items = [
      ['circle-check', 'Données fiables', '#059669'],
      ['lock', 'Protégées', '#84411a'],
      ['globe', 'Pensées pour le terrain', '#84411a'],
    ];
    items.forEach(([ic, txt, c], i) => puce(p, txt, ic, V ? 120 : 140, (V ? 1120 : 470) + i * (V ? 140 : 130), V ? 46 : 42, 1.0 + i * (d / 5), c));
  },

  cta(p, d) {
    const cw = V ? 940 : 1260;
    const ch = V ? 1120 : 820;
    const cx = W / 2 - cw / 2;
    const cy = V ? 300 : 90;
    const carte = el('div', 'abs carte-blanche', p, pos(cx, cy, cw, ch));
    anim(carte, [[0, 0.8, { o: [0, 1], s: [0.7, 1], y: [80, 0] }, 'rebond']]);
    const c = (txt, y, taille, couleur, poids = 800) => {
      const e = el('div', 'abs', carte, { left: 0, width: '100%', top: px(y), textAlign: 'center', fontSize: px(taille), color: couleur, fontWeight: poids });
      e.textContent = txt;
      return e;
    };
    pastille(carte, 'download', cw / 2 - 75, V ? 70 : 50, 150, 0.6);
    const m = c('Passage, le suivi des élèves pensé pour SchoolLogs', V ? 260 : 230, V ? 34 : 34, '#6a3419', 600);
    anim(m, [[0.9, 1.4, { o: [0, 1] }, 'lin']]);
    const a = c('Téléchargez SchoolLogs', V ? 330 : 290, V ? 80 : 84, '#2b1320');
    anim(a, [[1.2, 1.8, { o: [0, 1], y: [30, 0] }, 'out']]);
    // Adresse qui s'écrit lettre à lettre, comme une saisie.
    const site = c('', V ? 470 : 400, V ? 92 : 96, '#a2541c');
    site.dataset.texte = 'schoollogs.com';
    anim(site, [[2.0, 3.2, { lettres: [0, 14] }, 'lin']]);
    const b = el('div', 'abs bouton', carte, { left: px(cw / 2 - (V ? 260 : 250)), top: px(V ? 640 : 545), padding: '22px 44px', fontSize: px(V ? 44 : 42) });
    b.appendChild(icone('download', 46, '#fff', 2.5));
    el('span', '', b).textContent = 'Télécharger';
    anim(b, [[3.3, 3.8, { o: [0, 1], s: [0.6, 1] }, 'rebond'], [3.8, d, { lueur: [10, 40] }, 'inout']]);
    const q = c('Une question ?', V ? 800 : 380, V ? 40 : 1, '#334155', 600);
    if (!V) q.style.display = 'none';
    const mail = el('div', 'abs', carte, { left: 0, width: '100%', top: px(V ? 860 : 690), display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', fontSize: px(V ? 42 : 40), color: '#334155', fontWeight: 600 });
    mail.appendChild(icone('mail', V ? 46 : 44, '#84411a', 2.2));
    const ad = el('span', '', mail);
    ad.dataset.texte = V ? 'support@schoollogs.com' : 'Une question ? support@schoollogs.com';
    anim(mail, [[d * 0.55, d * 0.55 + 0.3, { o: [0, 1] }, 'lin']]);
    anim(ad, [[d * 0.55, d * 0.55 + 1.6, { lettres: [0, ad.dataset.texte.length] }, 'lin']]);
    anim(q, [[d * 0.5, d * 0.5 + 0.4, { o: [0, 1] }, 'lin']]);
    const proto = c('Prototype réalisé dans le cadre du test technique Afric’Éduc', ch - (V ? 70 : 55), V ? 24 : 24, '#94a3b8', 500);
    anim(proto, [[1.5, 2.0, { o: [0, 1] }, 'lin']]);
  },

  fin(p) {
    const L = V ? 260 : 220;
    const cy = V ? 600 : 220;
    ondes(p, W / 2, cy + L / 2, L * 0.7, 0.1, 2);
    const logo = el('div', 'abs', p, pos(W / 2 - L / 2, cy, L, L));
    logo.innerHTML = `<svg viewBox="0 0 512 512" width="${L}" height="${L}"><rect width="512" height="512" rx="112" fill="#84411a"/><path d="M168 360V152h104a64 64 0 0 1 0 128h-56" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/><circle cx="344" cy="344" r="28" fill="#e6a865"/></svg>`;
    anim(logo, [[0, 0.7, { s: [0.4, 1], o: [0, 1] }, 'rebond']]);
    titre(p, ['Passage'], 0, cy + L + 40, V ? 140 : 130, 0.4, { centre: true, largeur: W });
    titre(p, ["L'école *sait."], 0, cy + L + (V ? 230 : 200), V ? 66 : 60, 1.0, { centre: true, largeur: W });
    titre(p, ['Les parents sont *rassurés.'], 0, cy + L + (V ? 320 : 280), V ? 66 : 60, 1.5, { centre: true, largeur: W });
  },
};

const TRANSITIONS = {
  intro: 'fondu',
  questions: 'zoom',
  solution: 'cercle',
  eleve: 'glisse',
  agent: 'zoom',
  parents: 'cercle',
  exceptions: 'glisse',
  copie: 'zoom',
  synthese: 'cercle',
  partenaires: 'glisse',
  cta: 'cercle',
  fin: 'zoom',
};

// ---------- Construction et affichage ----------
let FOND;
let SOUS_TITRES = [];

window.construire = function ({ format, plans, sousTitres }) {
  V = format === '9x16';
  W = V ? 1080 : 1920;
  H = V ? 1920 : 1080;
  const scene = document.getElementById('scene');
  Object.assign(scene.style, { width: px(W), height: px(H) });
  FOND = fond(scene);
  for (const { nom, debut, fin } of plans) {
    const plan = el('div', 'plan', FOND.plans);
    transition(plan, TRANSITIONS[nom], debut);
    T0 = debut;
    SCENES[nom](plan, fin - debut);
    if (nom !== 'fin') sortie(plan, fin + 0.6);
    PLANS.push({ el: plan, debut, fin: fin + 0.6 });
  }
  // Sous-titres : bandeau en bas, deux lignes au plus.
  const zone = el('div', 'stz', scene, { bottom: px(V ? 110 : 44) });
  SOUS_TITRES = sousTitres.map((s) => {
    const b = el('div', 'st', zone, { fontSize: px(V ? 50 : 46), display: 'none' });
    b.innerHTML = s.lignes.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
    return { ...s, b };
  });
};

window.afficher = function (t) {
  FOND.animer(t);
  for (const pl of PLANS) pl.el.style.display = t >= pl.debut - 0.01 && t <= pl.fin ? 'block' : 'none';
  for (const { el: e, segments } of PISTES) {
    const debut = segments[0][0];
    // Les éléments des plans invisibles ne sont pas recalculés.
    if (e.closest && e.closest('.plan') && e.closest('.plan').style.display === 'none') continue;
    appliquer(e, valeurs(segments, t));
    if (t < debut && segments[0][2].o) e.style.opacity = segments[0][2].o[0];
  }
  for (const s of SOUS_TITRES) {
    const visible = t >= s.debut && t < s.fin;
    s.b.style.display = visible ? 'inline-block' : 'none';
    if (visible) s.b.style.opacity = Math.min(1, (t - s.debut) / 0.15);
  }
};
