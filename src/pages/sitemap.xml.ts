import type { APIRoute } from 'astro';
import { allPages } from '../data/pages';

// Gerado a partir do registro de páginas: toda página nova entra aqui sozinha.
// Sem <lastmod>: uma data que muda a cada deploy não é confiável para o Google.
export const GET: APIRoute = ({ site }) => {
  const urls = allPages.map((page) => `  <url>\n    <loc>${new URL(page.path, site).href}</loc>\n  </url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
