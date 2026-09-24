/**
 * Registro central das páginas indexáveis. Alimenta metatags, sitemap,
 * breadcrumbs (JSON-LD) e os links de "Outras ferramentas".
 */
export interface PageInfo {
  path: string;
  /** <title>: palavra-chave no início, até ~60 caracteres. */
  title: string;
  /** Meta description: até ~155 caracteres. */
  description: string;
  /** Nome curto para links internos e breadcrumbs. */
  name: string;
  /** Nome no JSON-LD WebApplication. */
  appName: string;
  group: 'image' | 'pdf';
}

export const pages = {
  compress: {
    path: '/',
    title: 'Compressor de imagens online grátis: PNG, JPG e WebP | Kompres',
    description: 'Comprima e converta PNG, JPG e WebP em lote, grátis e sem enviar imagens ao servidor. Ajuste o tamanho em KB e baixe os arquivos em ZIP.',
    name: 'Comprimir imagens',
    appName: 'Kompres',
    group: 'image',
  },
  resize: {
    path: '/resizer/',
    title: 'Redimensionar imagens online em lote grátis | Kompres',
    description: 'Redimensione PNG, JPG e WebP por largura ou porcentagem, mantendo a proporção. Veja as novas dimensões e baixe suas imagens em lote gratuitamente.',
    name: 'Redimensionar imagens',
    appName: 'Kompres Resizer',
    group: 'image',
  },
  background: {
    path: '/remover-fundo/',
    title: 'Remover fundo de imagem online grátis com IA | Kompres',
    description: 'Remova o fundo de fotos com IA direto no navegador, sem enviar as imagens. Ajuste o recorte com pincel e baixe em PNG transparente, grátis.',
    name: 'Remover fundo de imagem',
    appName: 'Kompres Remover Fundo',
    group: 'image',
  },
  pngToJpg: {
    path: '/converter/png-para-jpg/',
    title: 'Converter PNG para JPG online grátis e em lote | Kompres',
    description: 'Converta PNG para JPG em lote, direto no navegador e sem upload. Áreas transparentes recebem fundo branco. Grátis, com ajuste de qualidade e ZIP.',
    name: 'PNG para JPG',
    appName: 'Kompres PNG para JPG',
    group: 'image',
  },
  webpToJpg: {
    path: '/converter/webp-para-jpg/',
    title: 'Converter WebP para JPG online grátis e em lote | Kompres',
    description: 'Transforme imagens WebP em JPG compatível com qualquer programa. Conversão em lote no navegador, sem enviar arquivos, com download em ZIP.',
    name: 'WebP para JPG',
    appName: 'Kompres WebP para JPG',
    group: 'image',
  },
  webpToPng: {
    path: '/converter/webp-para-png/',
    title: 'Converter WebP para PNG online grátis e em lote | Kompres',
    description: 'Converta WebP para PNG mantendo a transparência. Em lote, direto no navegador e sem upload dos arquivos. Grátis e com download em ZIP.',
    name: 'WebP para PNG',
    appName: 'Kompres WebP para PNG',
    group: 'image',
  },
  pdfMerge: {
    path: '/pdf/',
    title: 'Juntar PDF online grátis: una arquivos em um só | Kompres',
    description: 'Junte vários PDFs em um único arquivo, na ordem que quiser, direto no navegador. Grátis, sem cadastro e sem enviar documentos ao servidor.',
    name: 'Juntar PDF',
    appName: 'Kompres PDF',
    group: 'pdf',
  },
  pdfCompress: {
    path: '/pdf/comprimir/',
    title: 'Comprimir PDF online grátis: reduza o tamanho | Kompres',
    description: 'Reduza o tamanho de PDFs no navegador preservando o texto selecionável. Escolha resolução e qualidade. Grátis, sem cadastro e sem upload.',
    name: 'Comprimir PDF',
    appName: 'Kompres Comprimir PDF',
    group: 'pdf',
  },
  pdfFromImages: {
    path: '/pdf/jpg-para-pdf/',
    title: 'Converter JPG para PDF online grátis | Kompres',
    description: 'Transforme imagens JPG e PNG em um PDF, na ordem que quiser. Escolha A4 ou o tamanho da imagem e a margem. Grátis e sem upload dos arquivos.',
    name: 'JPG para PDF',
    appName: 'Kompres JPG para PDF',
    group: 'pdf',
  },
  pdfSplit: {
    path: '/pdf/dividir/',
    title: 'Dividir PDF e extrair páginas online grátis | Kompres',
    description: 'Extraia páginas de um PDF ou divida o documento em um arquivo por página. Use intervalos como 1-3, 7. Grátis, no navegador e sem upload.',
    name: 'Dividir PDF',
    appName: 'Kompres Dividir PDF',
    group: 'pdf',
  },
  pdfToImages: {
    path: '/pdf/pdf-para-jpg/',
    title: 'Converter PDF para JPG ou PNG online grátis | Kompres',
    description: 'Transforme páginas de PDF em imagens JPG ou PNG em até 200 DPI. Escolha as páginas e baixe tudo em ZIP. Grátis e sem enviar o documento.',
    name: 'PDF para JPG',
    appName: 'Kompres PDF para JPG',
    group: 'pdf',
  },
} satisfies Record<string, PageInfo>;

export type PageKey = keyof typeof pages;
export const allPages: PageInfo[] = Object.values(pages);
