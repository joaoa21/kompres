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
    description: 'Comprima e converta PNG, JPG e WebP em lote, grátis e sem enviar arquivos. Também redimensione, recorte, remova o fundo e edite PDFs.',
    name: 'Comprimir imagens',
    appName: 'Kompres',
    group: 'image',
  },
  resize: {
    path: '/resizer/',
    title: 'Redimensionar imagens online em lote grátis | Kompres',
    description: 'Redimensione PNG, JPG e WebP por largura, altura, porcentagem ou medida exata, como 1080 × 1080. Em lote, grátis e sem enviar as imagens.',
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
  rotateImage: {
    path: '/girar/',
    title: 'Girar e espelhar imagens online grátis em lote | Kompres',
    description: 'Gire fotos em 90° ou 180° e espelhe na horizontal ou vertical, em lote e direto no navegador. Mantém o formato e a transparência. Grátis e sem upload.',
    name: 'Girar e espelhar imagens',
    appName: 'Kompres Girar Imagens',
    group: 'image',
  },
  cropImage: {
    path: '/recortar/',
    title: 'Recortar imagem online grátis: 1:1, 4:5 e 16:9 | Kompres',
    description: 'Recorte fotos livremente ou em proporções prontas para Instagram, YouTube e perfil. Direto no navegador, sem enviar a imagem. Baixe em PNG, JPG ou WebP.',
    name: 'Recortar imagem',
    appName: 'Kompres Recortar',
    group: 'image',
  },
  watermarkImage: {
    path: '/marca-dagua/',
    title: "Marca d'água em imagens online grátis e em lote | Kompres",
    description: "Adicione texto ou logo como marca d'água em várias fotos de uma vez. Escolha posição, tamanho e opacidade. Direto no navegador, grátis e sem upload.",
    name: "Marca d'água em imagem",
    appName: "Kompres Marca d'água",
    group: 'image',
  },
  svgToPng: {
    path: '/converter/svg-para-png/',
    title: 'Converter SVG para PNG online grátis | Kompres',
    description: 'Transforme arquivos SVG em PNG com fundo transparente, na largura que você escolher. Em lote, direto no navegador e sem upload. Grátis.',
    name: 'SVG para PNG',
    appName: 'Kompres SVG para PNG',
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
  pdfRemove: {
    path: '/pdf/remover-paginas/',
    title: 'Remover páginas de PDF online grátis | Kompres',
    description: 'Apague páginas de um PDF sem instalar nada: informe quais sair, como 2, 5-7, e baixe o arquivo. Grátis, no navegador e sem upload do documento.',
    name: 'Remover páginas de PDF',
    appName: 'Kompres Remover Páginas',
    group: 'pdf',
  },
  pdfRotate: {
    path: '/pdf/girar/',
    title: 'Girar PDF online grátis: 90° ou 180° | Kompres',
    description: 'Gire todas as páginas ou só algumas de um PDF em 90° ou 180° e salve o arquivo corrigido. Grátis, direto no navegador e sem enviar o documento.',
    name: 'Girar PDF',
    appName: 'Kompres Girar PDF',
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
  pdfWatermark: {
    path: '/pdf/marca-dagua/',
    title: "Marca d'água em PDF online grátis: texto ou imagem | Kompres",
    description: "Insira texto ou imagem como marca d'água em todas as páginas ou só em algumas. Ajuste posição, tamanho e opacidade. Grátis, no navegador e sem upload.",
    name: "Marca d'água em PDF",
    appName: "Kompres Marca d'água em PDF",
    group: 'pdf',
  },
  pdfNumber: {
    path: '/pdf/numerar/',
    title: 'Numerar páginas de PDF online grátis | Kompres',
    description: 'Adicione números de página a um PDF: escolha posição, formato como "1 de 10" e o número inicial. Grátis, direto no navegador e sem enviar o documento.',
    name: 'Numerar páginas de PDF',
    appName: 'Kompres Numerar PDF',
    group: 'pdf',
  },
  pdfOrganize: {
    path: '/pdf/organizar/',
    title: 'Organizar páginas de PDF online grátis | Kompres',
    description: 'Reordene, gire e exclua páginas de um PDF arrastando as miniaturas. Veja o resultado antes de baixar. Grátis, no navegador e sem upload do arquivo.',
    name: 'Organizar páginas de PDF',
    appName: 'Kompres Organizar PDF',
    group: 'pdf',
  },
  pdfCrop: {
    path: '/pdf/recortar/',
    title: 'Recortar PDF online grátis: corte as margens | Kompres',
    description: 'Corte as margens de todas as páginas de um PDF informando as medidas em milímetros. Grátis, direto no navegador e sem enviar o documento.',
    name: 'Recortar PDF',
    appName: 'Kompres Recortar PDF',
    group: 'pdf',
  },
} satisfies Record<string, PageInfo>;

export type PageKey = keyof typeof pages;
export const allPages: PageInfo[] = Object.values(pages);
