/**
 * Texto das imagens de compartilhamento (Open Graph), uma por página.
 * As imagens são geradas no build por src/pages/og/[slug].png.ts.
 */
import { pages, type PageKey } from './pages';
import { icons } from './tools';

export interface OgCard {
  slug: string;
  headline: string;
  subline: string;
  icon: keyof typeof icons;
}

/** /pdf/girar/ → pdf-girar; / → inicio. */
export const ogSlug = (path: string) => path.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'inicio';

const cards: Record<PageKey, Omit<OgCard, 'slug'>> = {
  compress: { headline: 'Imagens e PDFs, direto no navegador', subline: 'Comprima, converta, recorte e edite. Grátis e sem enviar arquivos.', icon: 'shrink' },
  resize: { headline: 'Redimensionar imagens', subline: 'Por largura, altura, porcentagem ou medida exata, em lote.', icon: 'scaling' },
  background: { headline: 'Remover fundo', subline: 'Recorte com IA e baixe em PNG transparente.', icon: 'eraser' },
  rotateImage: { headline: 'Girar e espelhar imagens', subline: '90°, 180° ou espelho, em várias fotos de uma vez.', icon: 'flip' },
  cropImage: { headline: 'Recortar imagem', subline: 'Livre ou em 1:1, 4:5, 16:9 e outras proporções prontas.', icon: 'crop' },
  watermarkImage: { headline: "Marca d'água em imagens", subline: 'Texto ou logo em várias fotos, com posição e opacidade.', icon: 'stamp' },
  pngToJpg: { headline: 'PNG para JPG', subline: 'Converta em lote, com ajuste de qualidade.', icon: 'convert' },
  webpToJpg: { headline: 'WebP para JPG', subline: 'JPG compatível com qualquer programa, em lote.', icon: 'convert' },
  webpToPng: { headline: 'WebP para PNG', subline: 'Mantém a transparência. Em lote e sem upload.', icon: 'convert' },
  svgToPng: { headline: 'SVG para PNG', subline: 'Na largura que você escolher, com fundo transparente.', icon: 'convert' },
  upscaleImage: { headline: 'Melhorar imagem com IA', subline: 'Dobre a resolução e recupere nitidez, sem enviar a foto.', icon: 'sparkles' },
  blurImage: { headline: 'Desfocar imagem', subline: 'Desfoque ou pixele rostos, placas e dados de prints.', icon: 'blur' },
  heicToJpg: { headline: 'HEIC para JPG/PNG', subline: 'Fotos do iPhone em JPG ou PNG, em lote.', icon: 'phone' },
  pngToIco: { headline: 'Favicon ICO', subline: 'Ícone de site em vários tamanhos, a partir de PNG ou SVG.', icon: 'appWindow' },
  gifMaker: { headline: 'Criar GIF', subline: 'Junte fotos em um GIF animado, com ordem e velocidade.', icon: 'film' },
  jpgToPng: { headline: 'JPG para PNG', subline: 'Converta em lote, sem perder qualidade a cada edição.', icon: 'convert' },
  pngToWebp: { headline: 'PNG para WebP', subline: 'Imagens mais leves para sites, com transparência.', icon: 'convert' },
  compress100kb: { headline: 'Comprimir imagem para 100 KB', subline: 'Fotos no limite de formulários e cadastros, em um clique.', icon: 'shrink' },
  compress50kb: { headline: 'Comprimir foto para 50 KB', subline: 'Para concursos, matrículas e sites com limite de envio.', icon: 'shrink' },
  jpgToWebp: { headline: 'JPG para WebP', subline: 'Fotos bem mais leves, sem perda visível.', icon: 'convert' },
  pdfMerge: { headline: 'Juntar PDF', subline: 'Vários PDFs em um só, na ordem que você quiser.', icon: 'merge' },
  pdfCompress: { headline: 'Comprimir PDF', subline: 'Reduza o tamanho mantendo o texto selecionável.', icon: 'fileDown' },
  pdfFromImages: { headline: 'JPG para PDF', subline: 'Transforme imagens em um PDF, com A4 e margem.', icon: 'images' },
  pdfCompress1mb: { headline: 'Comprimir PDF para 1 MB', subline: 'Para caber no limite de formulários e e-mails.', icon: 'fileDown' },
  pdfSplit: { headline: 'Dividir PDF', subline: 'Extraia páginas ou separe uma por arquivo.', icon: 'split' },
  pdfRemove: { headline: 'Remover páginas de PDF', subline: 'Apague só as páginas de que você não precisa.', icon: 'fileMinus' },
  pdfRotate: { headline: 'Girar PDF', subline: 'Corrija páginas de lado ou de cabeça para baixo.', icon: 'rotate' },
  pdfToImages: { headline: 'PDF para JPG', subline: 'Páginas em JPG ou PNG, até 200 DPI.', icon: 'fileImage' },
  pdfWatermark: { headline: "Marca d'água em PDF", subline: 'Texto ou imagem em todas as páginas ou só em algumas.', icon: 'stamp' },
  pdfNumber: { headline: 'Numerar páginas de PDF', subline: 'Escolha posição, formato e número inicial.', icon: 'hash' },
  pdfOrganize: { headline: 'Organizar PDF', subline: 'Reordene, gire e exclua páginas pelas miniaturas.', icon: 'grid' },
  pngToPdf: { headline: 'PNG para PDF', subline: 'Prints e imagens em um PDF, na ordem que quiser.', icon: 'images' },
  pdfSign: { headline: 'Assinar PDF', subline: 'Desenhe ou envie sua assinatura e posicione na página.', icon: 'pen' },
  pdfToText: { headline: 'PDF para texto', subline: 'Copie ou baixe o texto do PDF em .txt.', icon: 'fileText' },
  pdfCrop: { headline: 'Recortar PDF', subline: 'Corte as margens de todas as páginas.', icon: 'crop' },
};

export const ogCards: OgCard[] = (Object.keys(cards) as PageKey[]).map((key) => ({
  slug: ogSlug(pages[key].path),
  ...cards[key],
}));
