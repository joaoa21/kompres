/**
 * Montagem das ferramentas com o ClientRouter do Astro.
 *
 * Os scripts em /public/js rodam uma única vez por sessão e só registram uma
 * função `mount(signal, document)`. A cada página exibida chamamos essas funções;
 * ao sair, o `signal` é abortado para liberar listeners globais, workers e memória.
 */
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { PDF_LIBS } from '../data/libs';

type Mount = (signal: AbortSignal, doc: Document) => void;
declare global {
  interface Window { kompres: { tools: Record<string, Mount> } }
}

let controller: AbortController | undefined;

/**
 * `document` restrito ao <body> da página em que a ferramenta foi montada.
 * Se um processamento terminar depois da navegação, ele atualiza os elementos
 * antigos (já fora da tela) em vez de mexer nos da página nova.
 */
function scopedDocument(root: HTMLElement): Document {
  return new Proxy(document, {
    get(target, prop) {
      if (prop === 'getElementById') return (id: string) => root.querySelector(`#${CSS.escape(id)}`);
      if (prop === 'querySelector') return (selector: string) => root.querySelector(selector);
      if (prop === 'querySelectorAll') return (selector: string) => root.querySelectorAll(selector);
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * As bibliotecas de PDF são pesadas e só entram na página de PDF. Ao passar o mouse
 * (ou o foco) num link para /pdf/, pedimos ao navegador que as baixe com prioridade
 * baixa: quando o clique vier, elas já estão no cache.
 */
let pdfLibsPrefetched = false;
function prefetchPdfLibs(event: Event) {
  if (pdfLibsPrefetched) return;
  const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!link || !link.pathname.startsWith('/pdf/') || document.body.dataset.tools?.includes('pdf')) return;
  pdfLibsPrefetched = true;
  for (const href of PDF_LIBS) {
    const tag = document.createElement('link');
    tag.rel = 'prefetch';
    tag.as = 'script';
    tag.href = href;
    document.head.append(tag);
  }
}

/**
 * Filtro por categoria acima dos cartões. A escolha fica guardada na sessão, por grupo
 * (imagem ou PDF), para não se perder ao trocar de ferramenta sem recarregar.
 */
function setupToolFilter(signal: AbortSignal) {
  const bar = document.querySelector<HTMLElement>('.tools-filter');
  const nav = document.querySelector<HTMLElement>('.tools-nav');
  if (!bar || !nav) return;
  const storageKey = `kompres-filtro-${bar.dataset.group}`;
  const apply = (filter: string, save: boolean) => {
    if (!bar.querySelector(`[data-filter="${CSS.escape(filter)}"]`)) filter = 'todas';
    nav.dataset.filter = filter;
    bar.querySelectorAll<HTMLButtonElement>('button[data-filter]').forEach((button) => {
      const on = button.dataset.filter === filter;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    nav.querySelectorAll<HTMLElement>('a[data-category]').forEach((card) => card.classList.toggle('match', card.dataset.category === filter));
    if (save) { try { sessionStorage.setItem(storageKey, filter); } catch {} }
  };
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(storageKey); } catch {}
  // A ferramenta aberta precisa continuar visível: fora do filtro guardado, mostra todas.
  const activeCategory = nav.querySelector<HTMLElement>('a.active')?.dataset.category;
  apply(saved && saved !== 'todas' && saved !== activeCategory ? 'todas' : saved || 'todas', false);
  bar.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-filter]');
    if (button) apply(button.dataset.filter!, true);
  }, { signal });
}

export function mountTools() {
  controller = new AbortController();
  for (const type of ['mouseover', 'focusin', 'touchstart']) {
    document.addEventListener(type, prefetchPdfLibs, { signal: controller.signal, passive: true });
  }
  setupToolFilter(controller.signal);
  // Celular: a navegação entre ferramentas rola na horizontal; centraliza o cartão ativo.
  const activeCard = document.querySelector<HTMLElement>('.tools-nav a.active');
  const nav = activeCard?.parentElement;
  if (activeCard && nav && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = activeCard.offsetLeft - (nav.clientWidth - activeCard.offsetWidth) / 2;
  }
  const doc = scopedDocument(document.body);
  for (const name of (document.body.dataset.tools ?? '').split(' ').filter(Boolean)) {
    try {
      window.kompres.tools[name]?.(controller.signal, doc);
    } catch (error) {
      console.error(`Falha ao iniciar "${name}"`, error);
    }
  }
}

export function unmountTools(event: Event) {
  controller?.abort();
  // O Astro troca os atributos do <html> pelos da página nova: preserva o tema
  // escolhido e evita a animação de entrada da barra de ferramentas.
  const next = (event as TransitionBeforeSwapEvent).newDocument.documentElement;
  next.classList.toggle('light', document.documentElement.classList.contains('light'));
  next.classList.add('vt-nav');
}
