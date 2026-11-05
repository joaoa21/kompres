import type { APIRoute } from 'astro';
import { allPages } from '../data/pages';

// Gerado a partir do registro de páginas: toda página nova entra aqui sozinha.
// <lastmod> vem de `updated` no registro: muda quando a página muda, não a cada deploy.
export const GET: APIRoute = ({ site }) => {
  const urls = allPages.map((page) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(page.updated)) throw new Error(`sitemap: data inválida em ${page.path}`);
    return `  <url>\n    <loc>${new URL(page.path, site).href}</loc>\n    <lastmod>${page.updated}</lastmod>\n  </url>`;
  }).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
