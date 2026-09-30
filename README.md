# Kompres

Ferramentas de imagem e PDF que rodam **100% no navegador**: comprimir, converter, redimensionar, remover fundo e organizar PDFs, sem enviar nenhum arquivo para servidor.

**[kompres.com.br](https://kompres.com.br)** · [Case no portfólio](https://joaoa.com.br/projetos/sites/kompres/)

![Kompres](https://kompres.com.br/og-image.png)

Nasceu de uma dor real do time de CRM em que eu trabalhava: converter e comprimir banners um a um, em sites cheios de anúncio e limite de arquivos. Virou uma ferramenta usada no dia a dia do time e aberta ao público.

## O que faz

- **Comprimir imagens** em lote (JPG, PNG, WebP), por qualidade ou por **tamanho-alvo** (ex.: "no máximo 200 KB").
- **Converter** entre formatos (PNG → JPG, WebP → JPG, WebP → PNG).
- **Redimensionar** em lote.
- **Remover fundo** com IA, direto no navegador.
- **PDF:** comprimir, dividir, juntar imagens em PDF e exportar páginas como imagem.
- Download individual ou em **ZIP**.

## Decisões técnicas

- **Privacidade por arquitetura:** todo o processamento acontece no dispositivo (Canvas, `OffscreenCanvas`, Web Workers). Nenhum arquivo sai do navegador.
- **Motor de PNG próprio** (`public/js/png-engine.js`): gera candidatos sem dithering com UPNG + pako, mede o erro visual de cada um e escolhe o menor arquivo que passa no limite de qualidade. Roda num Web Worker para não travar a interface e tem **teste de regressão** (`npm test`).
- **Remoção de fundo com IA local:** modelo BiRefNet via Transformers.js, em **WebGPU** (fp16) quando disponível, com fallback para WASM. A inferência e o refinamento de borda rodam num worker.
- **Navegação sem recarregar:** Astro com `ClientRouter`. Cada ferramenta registra uma função `mount(signal, document)`; ao trocar de página, um `AbortController` libera listeners, workers e memória.
- **Performance e SEO:** páginas estáticas geradas pelo Astro, prefetch no hover, assets com cache imutável, sitemap e uma página por ferramenta (boa para busca).

## Stack

Astro · TypeScript · JavaScript · Web Workers · Canvas / OffscreenCanvas · WebGPU · Transformers.js · pdf.js · pdf-lib · JSZip · UPNG · Netlify

## Rodar localmente

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # gera dist/
npm test         # teste de regressão do motor de PNG
```

## Estrutura

```
src/
  pages/            uma rota por ferramenta (/, /resizer/, /converter/…, /pdf/…, /remover-fundo/)
  layouts/          páginas de compressão e de PDF
  components/       cabeçalho, rodapé, navegação e as ferramentas (CompressorTool, PdfTool)
  scripts/app.ts    montagem/desmontagem das ferramentas a cada navegação
public/js/          lógica das ferramentas, workers e bibliotecas vendorizadas (com licenças)
tests/              teste de regressão do motor de PNG
```

---

Feito por **João Alberto** — designer e desenvolvedor front-end · [joaoa.com.br](https://joaoa.com.br) · [LinkedIn](https://www.linkedin.com/in/joaoa210/)
