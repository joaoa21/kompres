import type { APIRoute } from 'astro';
import { allPages } from '../data/pages';
import { ogCards, ogSlug } from '../data/og';

// /llms.txt: resumo do site em Markdown para assistentes e buscadores com IA (ChatGPT,
// Perplexity, Claude, Gemini). Gerado do registro de páginas: ferramenta nova entra sozinha.
export const GET: APIRoute = ({ site }) => {
  const line = (page: (typeof allPages)[number]) => {
    const card = ogCards.find((item) => item.slug === ogSlug(page.path));
    // A home usa um texto geral do site na imagem; aqui vale a descrição do compressor.
    const text = page.path === '/' ? 'Reduza o tamanho de PNG, JPG e WebP em lote, por qualidade ou tamanho máximo em KB, e converta entre formatos.' : card?.subline ?? page.description;
    return `- [${page.name}](${new URL(page.path, site).href}): ${text}`;
  };
  const body = `# Kompres

> Ferramentas gratuitas de imagem e PDF em português que funcionam inteiramente no navegador. Os arquivos não são enviados a nenhum servidor: a compressão, a conversão e a edição acontecem no próprio dispositivo. Sem cadastro, sem marca d'água no resultado e sem limite de uso.

Site: ${new URL('/', site).href}
Idioma: português do Brasil
Criado por: João Alberto (https://joaoa.com.br)

## Ferramentas de imagem

${allPages.filter((page) => page.group === 'image').map(line).join('\n')}

## Ferramentas de PDF

${allPages.filter((page) => page.group === 'pdf').map(line).join('\n')}

## Como funciona

- Tudo roda no navegador, com JavaScript, inclusive em celulares. Os arquivos não saem do dispositivo.
- Formatos de imagem: PNG, JPG (JPEG), WebP e SVG (entrada). Saída em PNG, JPG ou WebP.
- Processamento em lote: várias imagens de uma vez, com download individual ou em ZIP.
- O remover fundo usa um modelo de IA baixado uma vez para o navegador; as imagens continuam locais.
- PDFs protegidos por senha não são desbloqueados.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
