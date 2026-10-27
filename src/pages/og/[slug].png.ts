import type { APIRoute, GetStaticPaths } from 'astro';
import { ogCards, type OgCard } from '../../data/og';
import { renderOgImage } from '../../lib/og-image';

// Uma imagem de compartilhamento por página, gerada no build: /og/pdf-girar.png etc.
export const getStaticPaths: GetStaticPaths = () => ogCards.map((card) => ({ params: { slug: card.slug }, props: card }));

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImage(props as OgCard);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
