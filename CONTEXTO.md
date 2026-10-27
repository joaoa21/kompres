# Kompres — contexto para continuar numa sessão local

Este arquivo resume o estado do projeto para uma sessão do Claude Code rodando no computador do João. Leia tudo antes de agir. Responda sempre em português.

## O que é o projeto

Kompres (https://kompres.com.br) é um site de ferramentas de imagem e PDF que rodam **inteiramente no navegador**, sem upload de arquivos. Stack: **Astro 7** (saída estática), JavaScript puro em `public/js`, CSS em `public/css`. Hospedado na **Netlify** (deploy automático do `main`; `netlify.toml` na raiz). Dono: João Alberto (joaoams6@gmail.com).

Ferramentas: comprimir/converter imagens (`/`), redimensionar (`/resizer/`), remover fundo com IA (`/remover-fundo/`), PDF (`/pdf/` e subpáginas: comprimir, dividir, remover páginas, girar, JPG→PDF, PDF→JPG) e conversores (`/converter/png-para-jpg/` etc.). Todas usam as mesmas ferramentas com modo/formato inicial diferente, para SEO.

## Estrutura

- `src/layouts/Base.astro`: cabeçalho, navegação, metatags, JSON-LD, scripts compartilhados, `ClientRouter` (navegação sem recarregar).
- `src/layouts/CompressorPage.astro` e `PdfPage.astro`: páginas de ferramenta com textos próprios.
- `src/components/tools/*.astro`: marcação das ferramentas. `Guide.astro`: perguntas frequentes. `RelatedTools.astro`: links entre ferramentas.
- `src/data/pages.ts`: registro central de páginas (título, descrição, nome). Alimenta sitemap (`src/pages/sitemap.xml.ts`), breadcrumbs e links.
- `src/scripts/app.ts`: monta/desmonta as ferramentas a cada navegação (`astro:page-load` / `astro:before-swap`) e pré-busca as bibliotecas de PDF ao passar o mouse em links para `/pdf/`.
- `public/js/*.js`: cada ferramenta é `kompres.register('nome', (signal, document) => {...})`. `document` é restrito à página; `signal` aborta ao sair. Compartilhados: `input.js` (arrastar em qualquer lugar + colar), `png-client.js` (PNG otimizado via worker), `theme.js`, `selects.js`, `privacy.js`.
- `public/js/png-engine.js` + `png-worker.js`: compressor PNG próprio (sem dithering). Teste: `npm test` (`tests/regression.cjs`, precisa de `sharp`).
- Bibliotecas externas via CDN (cdnjs): JSZip, pdf.js 3.11.174, pdf-lib 1.17.1. Modelo de IA do remover fundo vem do Hugging Face (`background-worker.js`).

## Estado atual (27/10/2026)

**Publicado no `main`:** migração para Astro, SEO (páginas por busca, sitemap, breadcrumbs), navegação sem recarregar, rolagem suave na página de remover fundo, aviso de cookies integrado ao Trackik.

**No branch `claude/compassionate-ritchie-opi974` (commit `004bfe8`), AINDA NÃO PUBLICADO, aguardando avaliação do João num servidor local:**

- Lenis (rolagem suave) removido: rolagem nativa.
- Pré-busca das bibliotecas de PDF ao passar o mouse em "PDF"; transição de página mais curta; topo das páginas mais compacto.
- Compressor e redimensionador processam **automaticamente** ao soltar as imagens e refazem ao mudar qualquer configuração; aceitam arquivos durante o processamento. Botão vira "Comprimir/Redimensionar novamente".
- Arrastar para qualquer ponto da página e colar com Ctrl+V (compressor, redimensionador, remover fundo, Imagens → PDF).
- Segurar a miniatura de um resultado mostra o original.
- Um resultado só: botão "Baixar" entrega o arquivo direto, sem ZIP.
- Arquivos não suportados geram aviso (`.tool-status`).
- Redimensionador: modos **Altura** e **Exato** (largura × altura; preencher e cortar o centro, ou caber sem cortar). PNG passa pelo otimizador sem perdas (800→720 px: 568 KB → 219 KB).
- PDF: modos **Girar** e **Remover páginas**, com páginas `/pdf/girar/` e `/pdf/remover-paginas/`. Campo de páginas mostra o total e é limpo ao trocar de modo. Celular: modos em duas colunas.
- Removidos arquivos sem uso: `lenis-init.js`, `pdf-selects.js`, `vendor/image-q.min.js`.

Remover fundo e PDF continuam com botão (de propósito: modelo de IA pesado; juntar depende da ordem).

## O que fazer agora

1. Na pasta do projeto: `npm install` e `npm run dev` (Astro 7 deixa o servidor em segundo plano; `npx astro dev status` / `npx astro dev logs`). Abrir http://localhost:4321/.
2. O João vai avaliar as mudanças acima. Se ele pedir ajustes (por exemplo, voltar o processamento manual), fazer no mesmo branch.
3. Só depois da aprovação: abrir PR para `main` e fazer merge. **Cada PR gera um Deploy Preview e cada merge um deploy de produção na Netlify; os créditos do João estão acabando.** Agrupar mudanças, um push por PR, testar tudo localmente antes. Sugestão pendente: desligar Deploy Previews automáticos no painel da Netlify e, no próximo deploy, adicionar uma regra `ignore` no `netlify.toml`.
4. Depois do deploy: no Google Search Console, pedir indexação das páginas novas (`/pdf/girar/`, `/pdf/remover-paginas/`) e das que ficaram da lista anterior (`/converter/png-para-jpg/`, `/pdf/pdf-para-jpg/`, `/pdf/dividir/`, `/converter/webp-para-png/`, `/`). Em 2 a 4 semanas, exportar o relatório de Desempenho para ajustar textos.

## Como testar

- `npm run build` gera `dist/`; servir com `npx astro preview` ou `python -m http.server` dentro de `dist/`.
- Testes de ponta a ponta foram feitos com Playwright (Chromium) simulando arrastar, colar, downloads e lendo os PDFs gerados com pdf-lib. Os scripts ficaram num diretório temporário da sessão na nuvem e não estão no repositório; se precisar, recriar: suítes de regressão (ferramentas, páginas de SEO, navegação sem recarregar, tema, cookies) e de usabilidade (automático ao soltar, colar, modos novos, girar, remover).
- Auditoria de SEO da build: 1 H1 por página, título ≤ 62, descrição ≤ 160, canonical, sitemap completo, sem links quebrados.
- O remover fundo processando uma imagem de verdade nunca foi testado automaticamente (modelo externo). Vale testar no navegador.

## Decisões já tomadas (não reabrir sem motivo)

- Sem React/SPA pura: Astro estático mantém SEO e peso baixo; `ClientRouter` dá a fluidez.
- Sem prerender via Speculation Rules (executaria o analytics em páginas não visitadas).
- Sem `FAQPage` em JSON-LD (Google não mostra mais para sites comuns).
- `/resizer/` continua com esse nome (mudar exigiria redirect 301).
- Sem rolagem suave: é ferramenta, não landing page.

## Analytics

Dois sistemas: Google Analytics (só com aceite no aviso de cookies, `privacy.js`) e **Trackik** (projeto próprio do João, repositório `joaoa21/analytics-hub`, script `t.js` servido pela API no Railway). O Trackik conta navegações sem recarregar (intercepta `pushState`) e, desde o PR #6 do analytics-hub, grava o título certo nessas navegações. Áreas com nomes de arquivos usam `data-ah-mask` para não enviar texto.
