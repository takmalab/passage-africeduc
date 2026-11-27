// Génère le motif « école » du fond de la page de connexion :
// apps/web/public/motifs/ecole.svg, une tuile de 340 px répétée par le CSS.
// Les dessins sont les icônes Lucide (https://lucide.dev, licence ISC) déjà
// utilisées par l'application : aucune image de provenance incertaine.
// Usage, depuis la racine du dépôt : node scripts/school-pattern.mjs
import { writeFileSync } from 'node:fs';

const ICONS_DIR = new URL('../node_modules/lucide-react/dist/esm/icons/', import.meta.url);
const OUTPUT = new URL('../apps/web/public/motifs/ecole.svg', import.meta.url);

// [icône, x, y, rotation en degrés] : grille 4 x 4 décalée pour un effet « griffonné ».
const ITEMS = [
  ['book-open', 20, 20, -12],
  ['pencil', 105, 40, 20],
  ['graduation-cap', 190, 15, -6],
  ['ruler', 270, 45, 30],
  ['backpack', 45, 105, 8],
  ['school', 130, 120, -4],
  ['calculator', 215, 100, 14],
  ['apple', 290, 130, -10],
  ['bus', 15, 190, 6],
  ['notebook-pen', 100, 205, -16],
  ['globe', 180, 185, 10],
  ['lightbulb', 260, 210, -8],
  ['pen-tool', 55, 270, 22],
  ['library', 140, 285, -6],
  ['palette', 220, 265, 12],
  ['book-a', 300, 290, -14],
];

let body = '';
for (const [name, x, y, rotation] of ITEMS) {
  // Chaque fichier d'icône exporte __iconNode : la liste de ses formes SVG.
  const { __iconNode } = await import(new URL(`${name}.js`, ICONS_DIR).href);
  const shapes = __iconNode
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key]) => key !== 'key') // « key » sert à React, pas au SVG
        .map(([key, value]) => ` ${key}="${value}"`)
        .join('');
      return `<${tag}${attributes}/>`;
    })
    .join('');
  // Icône de 24 px agrandie à 34 px, tournée autour de son centre.
  body += `<g transform="translate(${x} ${y}) rotate(${rotation} 17 17) scale(1.4)">${shapes}</g>`;
}

// Traits ocre (brand-300) à 22 % d'opacité : le motif reste discret sur l'aubergine.
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="340" viewBox="0 0 340 340">` +
  `<!-- Motif école composé d'icônes Lucide (https://lucide.dev), licence ISC. -->` +
  `<g fill="none" stroke="#e6a865" stroke-opacity="0.22" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`;

writeFileSync(OUTPUT, svg);
console.log(`Motif écrit : ${OUTPUT.pathname} (${svg.length} octets)`);
