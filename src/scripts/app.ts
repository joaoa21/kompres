/**
 * Montagem das ferramentas com o ClientRouter do Astro.
 *
 * Os scripts em /public/js rodam uma única vez por sessão e só registram uma
 * função `mount(signal, document)`. A cada página exibida chamamos essas funções;
 * ao sair, o `signal` é abortado para liberar listeners globais, workers e memória.
 */
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

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

export function mountTools() {
  controller = new AbortController();
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
