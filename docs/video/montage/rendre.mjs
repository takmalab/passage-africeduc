// Rendu de la capsule (motion design) en MP4, formats 16:9 et 9:16.
//
// La page motion/index.html anime chaque scène en fonction du temps t ; ce script
// la photographie 30 fois par seconde dans Chromium (Playwright) et envoie les
// images à ffmpeg, avec la voix off.
//
// Usage (dans ce dossier, après « npm install ») :
//   VOIX=voix-elevenlabs.mp3 node rendre.mjs     rendu final calé sur la voix
//   node rendre.mjs                              aperçu muet, durées estimées
// Options : FORMATS=16x9 ou 9x16 ; IMAGES=2,10,25 (images fixes pour vérifier) ;
//           MUSIQUE=musique.mp3 (mixée bas sous la voix).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ICI = import.meta.dirname;
const VIDEO = `${ICI}/..`;
const SORTIE = `${ICI}/sortie`;
mkdirSync(SORTIE, { recursive: true });
const FPS = 30;
const INTRO = 3.2; // titre animé avant la première phrase (s)
const FIN_TENUE = 2.5; // l'image de fin reste après la dernière phrase (s)

// 1. Pictogrammes : icônes Lucide (licence ISC) copiées pour la page.
const NOMS = ['school', 'bus', 'door-open', 'nfc', 'circle-check', 'smartphone', 'key-round', 'wifi', 'wifi-off', 'refresh-cw', 'bell-ring', 'shield-check', 'lock', 'calendar-check', 'bell-off', 'camera', 'sparkles', 'chart-column', 'globe', 'download', 'mail', 'check'];
const icones = {};
for (const nom of NOMS) {
  const { __iconNode } = await import(`${ICI}/../../../node_modules/lucide-react/dist/esm/icons/${nom}.js`);
  icones[nom] = __iconNode.map(([tag, a]) => [tag, Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'key'))]);
}
writeFileSync(`${ICI}/motion/icones.js`, `// Généré par rendre.mjs : icônes Lucide (https://lucide.dev, licence ISC).\nwindow.ICONES = ${JSON.stringify(icones)};\n`);

// 2. Texte : un paragraphe par scène ; sous-titres en forme écrite.
const SCENES = ['questions', 'solution', 'eleve', 'agent', 'parents', 'exceptions', 'copie', 'synthese', 'partenaires', 'cta', 'fin'];
const paragraphes = readFileSync(`${VIDEO}/capsule-voix-off.txt`, 'utf8').trim().split(/\n\s*\n/).map((p) => p.replace(/<break[^>]*>/g, '').trim());
if (paragraphes.length !== SCENES.length) throw new Error(`${paragraphes.length} paragraphes pour ${SCENES.length} scènes.`);
const ecrit = (p) => p.replace(/support arobase schoollogs point com/gi, 'support@schoollogs.com').replace(/schoollogs point com/gi, 'schoollogs.com');

// 3. Calage : où commence et finit chaque phrase dans la voix.
function duree(fichier) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', fichier], { encoding: 'utf8' });
  const [, h, m, s] = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return +h * 3600 + +m * 60 + +s;
}
/** Phrases de la voix : position estimée d'après la longueur du texte, recalée sur le silence le plus proche. */
function caler(fichier) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', fichier, '-af', 'silencedetect=noise=-30dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' });
  const total = duree(fichier);
  const silences = [...r.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map(([, a, b]) => ({ a: +a, b: +b }));
  const debut = silences[0]?.a < 0.05 ? silences.shift().b : 0;
  const fin = silences.at(-1)?.b >= total - 0.05 ? silences.pop().a : total;
  const longueurs = paragraphes.map((p) => p.length);
  const somme = longueurs.reduce((a, b) => a + b, 0);
  const coupures = [];
  let cumul = 0;
  for (let k = 0; k < paragraphes.length - 1; k++) {
    cumul += longueurs[k];
    const estime = debut + ((fin - debut) * cumul) / somme;
    const apres = coupures.at(-1)?.b ?? debut;
    const candidats = silences.filter((s) => s.a > apres + 0.5);
    const proche = candidats.sort((x, y) => Math.abs((x.a + x.b) / 2 - estime) - Math.abs((y.a + y.b) / 2 - estime))[0];
    coupures.push(proche && Math.abs((proche.a + proche.b) / 2 - estime) < 2.5 ? proche : { a: estime - 0.1, b: estime + 0.1 });
  }
  const bornes = [debut, ...coupures.flatMap((c) => [c.a, c.b]), fin];
  return paragraphes.map((_, i) => ({ debut: bornes[2 * i], fin: bornes[2 * i + 1] }));
}
function estimer() {
  let t = 0;
  return paragraphes.map((p) => {
    const d = p.split(/\s+/).length * 0.29;
    const s = { debut: t, fin: t + d };
    t += d + 0.8;
    return s;
  });
}
const VOIX = process.env.VOIX ? resolve(process.env.VOIX) : null;
const phrases = VOIX ? caler(VOIX) : estimer();
const decalage = INTRO - phrases[0].debut; // la voix commence après le titre
const P = phrases.map((s) => ({ debut: s.debut + decalage, fin: s.fin + decalage }));
const DUREE = P.at(-1).fin + FIN_TENUE;

const plans = [{ nom: 'intro', debut: 0, fin: INTRO - 0.15 }];
SCENES.forEach((nom, k) => {
  const debut = k === 0 ? INTRO - 0.15 : (P[k - 1].fin + P[k].debut) / 2;
  const fin = k === SCENES.length - 1 ? DUREE : (P[k].fin + P[k + 1].debut) / 2;
  plans.push({ nom, debut, fin });
});
console.log(`Durée : ${DUREE.toFixed(1)} s (attendu : 60 à 90 s)${VOIX ? '' : ' — estimation sans voix'}`);
if (DUREE > 90) console.warn('Attention : plus de 90 s.');
if (process.env.IMAGES) for (const p of plans) console.log(`  ${p.nom.padEnd(12)} ${p.debut.toFixed(1)} → ${p.fin.toFixed(1)} s`);

/** Sous-titres : blocs de deux lignes, répartis au prorata de leur longueur. */
function sousTitres(maxCar) {
  const blocs = [];
  paragraphes.forEach((p, k) => {
    const lignes = [];
    let l = '';
    for (const mot of ecrit(p).split(' ')) {
      if ((l + ' ' + mot).trim().length > maxCar) {
        lignes.push(l);
        l = mot;
      } else l = (l + ' ' + mot).trim();
    }
    if (l) lignes.push(l);
    const groupes = [];
    for (let i = 0; i < lignes.length; i += 2) groupes.push(lignes.slice(i, i + 2));
    const total = groupes.reduce((s, g) => s + g.join(' ').length, 0);
    let t = P[k].debut;
    for (const g of groupes) {
      const d = ((P[k].fin - P[k].debut) * g.join(' ').length) / total;
      blocs.push({ lignes: g, debut: t, fin: t + d });
      t += d;
    }
  });
  return blocs;
}

// 4. Rendu de chaque format.
const navigateur = await chromium.launch();
for (const format of (process.env.FORMATS ?? '16x9,9x16').split(',')) {
  const [W, H] = format === '9x16' ? [1080, 1920] : [1920, 1080];
  const st = sousTitres(format === '9x16' ? 30 : 44);
  if (format === '16x9') {
    const temps = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
    writeFileSync(`${VIDEO}/capsule.srt`, st.map((b, i) => `${i + 1}\n${temps(b.debut)} --> ${temps(b.fin)}\n${b.lignes.join('\n')}\n`).join('\n'));
  }
  const page = await navigateur.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error('Erreur dans la page :', e.message));
  await page.goto(`file://${ICI}/motion/index.html`);
  await page.evaluate((args) => window.construire(args), { format, plans, sousTitres: st });
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))));
  await page.evaluate(() => document.fonts.ready);

  if (process.env.IMAGES) {
    for (const t of process.env.IMAGES.split(',').map(Number)) {
      await page.evaluate((x) => window.afficher(x), t);
      await page.screenshot({ path: `${SORTIE}/image-${format}-${t}.png` });
    }
    console.log(`${format} : images fixes dans sortie/`);
    await page.close();
    continue;
  }

  const mp4 = `${SORTIE}/capsule-${format}.mp4`;
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  const audio = [];
  if (VOIX) {
    args.push('-i', VOIX);
    audio.push(`[1:a]aresample=48000,adelay=${Math.round(decalage * 1000)}:all=1[voix]`);
  }
  if (process.env.MUSIQUE) {
    args.push('-stream_loop', '-1', '-i', process.env.MUSIQUE);
    audio.push(`[${VOIX ? 2 : 1}:a]aresample=48000,volume=0.10[mus]`);
  }
  if (audio.length) {
    const entrees = (VOIX ? '[voix]' : '') + (process.env.MUSIQUE ? '[mus]' : '');
    audio.push(`${entrees}amix=inputs=${audio.length}:normalize=0:duration=longest,afade=t=out:st=${(DUREE - 1.2).toFixed(2)}:d=1.2[a]`);
    args.push('-filter_complex', audio.join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-t', DUREE.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const images = Math.ceil(DUREE * FPS);
  for (let i = 0; i < images; i++) {
    await page.evaluate((x) => window.afficher(x), i / FPS);
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(jpeg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r${format} : ${Math.round((100 * i) / images)} %`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\r${format} prêt : ${mp4}`);
  await page.close();
}
await navigateur.close();
