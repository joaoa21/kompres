/**
 * Navegação entre ferramentas (cartões abaixo do cabeçalho): nome curto,
 * descrição de uma linha e ícone. Os caminhos vêm do registro de páginas.
 */
import { pages, type PageKey } from './pages';

export type ToolKey = PageKey;

/** Categorias do filtro acima dos cartões. */
export type ToolCategory = 'otimizar' | 'editar' | 'converter' | 'organizar';
export const categoryLabels: Record<ToolCategory, string> = {
  otimizar: 'Otimizar', editar: 'Editar', converter: 'Converter', organizar: 'Organizar',
};

export interface ToolNavItem {
  key: ToolKey;
  href: string;
  label: string;
  description: string;
  category: ToolCategory;
  /** Conteúdo de um <svg viewBox="0 0 24 24"> em traço (ícones Lucide, MIT). */
  icon: string;
}

export const icons = {
  shrink: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  scaling: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 15H9v-5"/><path d="M16 3h5v5"/><path d="M21 3 9 15"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  // Dois quadrados preenchidos com setas recortadas: para o centro (juntar) ou para fora (dividir).
  merge: '<rect class="fill" x="0" y="0" width="12.5" height="12.5" rx="2.5"/><rect class="fill" x="11.5" y="11.5" width="12.5" height="12.5" rx="2.5"/><path class="cut" d="m2.8 2.8 6.6 6.6"/><polyline class="cut" points="9.4 5.4 9.4 9.4 5.4 9.4"/><path class="cut" d="m21.2 21.2-6.6-6.6"/><polyline class="cut" points="14.6 18.6 14.6 14.6 18.6 14.6"/>',
  split: '<rect class="fill" x="0" y="0" width="12.5" height="12.5" rx="2.5"/><rect class="fill" x="11.5" y="11.5" width="12.5" height="12.5" rx="2.5"/><path class="cut" d="m9.4 9.4-6.6-6.6"/><polyline class="cut" points="2.8 6.8 2.8 2.8 6.8 2.8"/><path class="cut" d="m14.6 14.6 6.6 6.6"/><polyline class="cut" points="21.2 17.2 21.2 21.2 17.2 21.2"/>',
  fileDown: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
  fileMinus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  fileImage: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"/>',
  flip: '<path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  stamp: '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  convert: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  blur: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  appWindow: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
};

const item = (key: ToolKey, label: string, description: string, icon: keyof typeof icons, category: ToolCategory): ToolNavItem =>
  ({ key, href: pages[key].path, label, description, icon: icons[icon], category });

export const toolGroups: Record<'image' | 'pdf', ToolNavItem[]> = {
  image: [
    item('compress', 'Comprimir e converter', 'Menos KB em WebP, PNG ou JPG', 'shrink', 'otimizar'),
    item('resize', 'Redimensionar', 'Largura, altura ou medida exata', 'scaling', 'otimizar'),
    item('upscaleImage', 'Melhorar com IA', 'Resolução 2x e mais nitidez', 'sparkles', 'otimizar'),
    item('background', 'Remover fundo', 'Recorte com IA, PNG transparente', 'eraser', 'editar'),
    item('rotateImage', 'Girar e espelhar', '90°, 180° ou espelho, em lote', 'flip', 'editar'),
    item('cropImage', 'Recortar', 'Livre ou em proporções prontas', 'crop', 'editar'),
    item('watermarkImage', "Marca d'água", 'Texto ou logo sobre as fotos', 'stamp', 'editar'),
    item('blurImage', 'Desfocar', 'Esconda rostos, placas e dados', 'blur', 'editar'),
    item('svgToPng', 'SVG para PNG', 'Na largura que quiser, transparente', 'convert', 'converter'),
    item('heicToJpg', 'HEIC para JPG/PNG', 'Fotos do iPhone em JPG ou PNG', 'phone', 'converter'),
    item('pngToIco', 'Favicon (ICO)', 'Ícone de site em vários tamanhos', 'appWindow', 'converter'),
    item('gifMaker', 'Criar GIF', 'Fotos viram um GIF animado', 'film', 'converter'),
  ],
  pdf: [
    item('pdfMerge', 'Juntar', 'Vários PDFs em um só', 'merge', 'organizar'),
    item('pdfSplit', 'Extrair / dividir', 'Salve só algumas páginas', 'split', 'organizar'),
    item('pdfRemove', 'Remover páginas', 'Tire páginas do arquivo', 'fileMinus', 'organizar'),
    item('pdfRotate', 'Girar', 'Corrija a orientação', 'rotate', 'organizar'),
    item('pdfOrganize', 'Organizar', 'Reordene, gire e exclua páginas', 'grid', 'organizar'),
    item('pdfCompress', 'Comprimir', 'Reduza o tamanho do arquivo', 'fileDown', 'otimizar'),
    item('pdfFromImages', 'Imagens → PDF', 'JPG e PNG viram páginas', 'images', 'converter'),
    item('pdfToImages', 'PDF → imagens', 'Páginas em JPG ou PNG', 'fileImage', 'converter'),
    item('pdfToText', 'PDF → texto', 'Copie ou baixe o texto em .txt', 'fileText', 'converter'),
    item('pdfSign', 'Assinar', 'Desenhe ou envie sua assinatura', 'pen', 'editar'),
    item('pdfWatermark', "Marca d'água", 'Texto ou imagem nas páginas', 'stamp', 'editar'),
    item('pdfNumber', 'Numerar', 'Números de página', 'hash', 'editar'),
    item('pdfCrop', 'Recortar', 'Corte as margens das páginas', 'crop', 'editar'),
  ],
};

export function groupOf(key: ToolKey): 'image' | 'pdf' {
  return pages[key].group;
}
