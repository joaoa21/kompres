/**
 * Desenha a imagem de compartilhamento (1200 × 630) de uma ferramenta com o sharp.
 * As fontes vêm de src/assets/og-fonts (Syne e Inter, licença OFL), então o resultado
 * é igual no computador e no build da Netlify, sem depender de fontes do sistema.
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { icons } from '../data/tools';
import type { OgCard } from '../data/og';

const W = 1200, H = 630, PAD = 80;
const FONTS = join(process.cwd(), 'src', 'assets', 'og-fonts');
const ACCENT = '#b8f55a', INK = '#0c0c0d';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto com fonte e cor fixas; devolve o PNG e a altura para posicionar o próximo bloco. */
async function text(content: string, font: string, file: string, color: string, width: number) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}">${content}</span>`,
      font,
      fontfile: join(FONTS, file),
      width,
      wrap: 'word',
      rgba: true,
      dpi: 72,
    },
  }).png().toBuffer({ resolveWithObject: true });
  return { input: data, height: info.height, width: info.width };
}

const logo = `<svg width="56" height="56" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="18" fill="${ACCENT}"/>
  <path d="M31.254 32.35V30.222L53.18 44.32H39.044L20.424 31.4L37.6 20H51.128L31.254 32.35ZM11 20H20.5V44.32H11V20Z" fill="${INK}"/>
</svg>`;

const TILE = 208;
const iconTile = (body: string) => `<svg width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}" xmlns="http://www.w3.org/2000/svg">
  <style>.fill{fill:${INK};stroke:none}.cut{stroke:${ACCENT};stroke-width:1.6}</style>
  <rect width="${TILE}" height="${TILE}" rx="52" fill="${ACCENT}"/>
  <g transform="translate(44 44) scale(5)" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</g>
</svg>`;

// Brilho verde suave no canto, como no fundo do site.
const backdrop = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="90%" cy="0%" r="75%">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="${ACCENT}"/>
</svg>`;

export async function renderOgImage(card: OgCard): Promise<Buffer> {
  // Texto numa coluna à esquerda; o ícone da ferramenta fica grande à direita.
  const column = W - PAD * 2 - TILE - 56;
  const brand = await text('Kompres', 'Syne Bold 40', 'Syne-Bold.ttf', '#f0f0ee', 400);

  // Títulos longos descem de tamanho para caber em até duas linhas.
  let title = await text(escape(card.headline), 'Syne Bold 72', 'Syne-Bold.ttf', '#ffffff', column);
  if (title.height > 190) title = await text(escape(card.headline), 'Syne Bold 58', 'Syne-Bold.ttf', '#ffffff', column);

  const sub = await text(escape(card.subline), 'Inter 32', 'Inter-Regular.ttf', '#b4b4b0', column);
  const site = await text('<b>kompres.com.br</b>  ·  grátis, sem upload, direto no navegador', 'Inter 26', 'Inter-SemiBold.ttf', ACCENT, W - PAD * 2);

  // O bloco título + descrição fica centralizado na altura entre o logo e o rodapé.
  const top = 150, bottom = H - 72 - site.height - 24;
  const block = title.height + 20 + sub.height;
  const titleTop = Math.max(top, Math.round(top + (bottom - top - block) / 2));
  const subTop = titleTop + title.height + 20;

  return sharp(Buffer.from(backdrop))
    .composite([
      { input: Buffer.from(logo), left: PAD, top: 64 },
      { input: brand.input, left: PAD + 72, top: 64 + Math.round((56 - brand.height) / 2) },
      { input: title.input, left: PAD, top: titleTop },
      { input: sub.input, left: PAD, top: subTop },
      { input: Buffer.from(iconTile(icons[card.icon])), left: W - PAD - TILE, top: Math.round((H - TILE) / 2) - 10 },
      { input: site.input, left: PAD, top: H - 64 - site.height },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
