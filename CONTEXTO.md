# Kompres — contexto para continuar numa sessão local

Este arquivo resume o estado do projeto para uma sessão do Claude Code rodando no computador do João. Leia tudo antes de agir. Responda sempre em português.

## O que é o projeto

Kompres (https://kompres.com.br) é um site de ferramentas de imagem e PDF que rodam **inteiramente no navegador**, sem upload de arquivos. Stack: **Astro 7** (saída estática), JavaScript puro em `public/js`, CSS em `public/css`. Hospedado na **Netlify** (deploy automático do `main`; `netlify.toml` na raiz). Dono: João Alberto (joaoams6@gmail.com).

Ferramentas de imagem: comprimir/converter (`/`, aceita SVG), redimensionar (`/resizer/`), melhorar com IA 2× (`/melhorar-imagem/`, modelo Swin2SR no navegador), remover fundo com IA (`/remover-fundo/`), girar e espelhar (`/girar/`), recortar (`/recortar/`), marca d'água com posição livre (`/marca-dagua/`), desfocar ou pixelar áreas retangulares ou ovais (`/desfocar/`), HEIC para JPG/PNG (`/converter/heic-para-jpg/`, heic2any sob demanda), favicon ICO (`/converter/png-para-ico/`), criar GIF (`/criar-gif/`, gifenc em worker) e conversores (`/converter/png-para-jpg/`, `jpg-para-png`, `png-para-webp`, `jpg-para-webp`, `webp-para-jpg`, `webp-para-png`, `svg-para-png`). PDF: juntar (`/pdf/`), comprimir, dividir, remover páginas, girar, organizar, JPG/PNG→PDF (com câmera no celular), PDF→JPG, PDF→texto, assinar (`/pdf/assinar/`, letra de mão Mrs Saint Delafield, a mesma do Propostaria), marca d'água com posição livre, numerar e recortar margens. Os cartões de navegação têm filtro por categoria (Otimizar, Editar, Converter, Organizar), guardado na sessão.

## Estrutura

- `src/layouts/Base.astro`: cabeçalho, navegação, metatags, JSON-LD, scripts compartilhados, `ClientRouter` (navegação sem recarregar).
- `src/layouts/CompressorPage.astro` e `PdfPage.astro`: páginas de ferramenta com textos próprios.
- `src/components/tools/*.astro`: marcação das ferramentas. `Guide.astro`: perguntas frequentes. `SiteFooter.astro`: rodapé com todas as ferramentas por assunto (o build falha se uma página nova ficar sem coluna).
- `src/data/pages.ts`: registro central de páginas (título, descrição, nome). Alimenta sitemap (`src/pages/sitemap.xml.ts`), breadcrumbs e links.
- `src/scripts/app.ts`: monta/desmonta as ferramentas a cada navegação (`astro:page-load` / `astro:before-swap`) e pré-busca as bibliotecas de PDF ao passar o mouse em links para `/pdf/`.
- `src/data/tools.ts` + `src/components/ToolsNav.astro`: cartões de navegação (ícone, nome, descrição) abaixo do cabeçalho; `Base.astro` recebe `activeTool`.
- `public/js/*.js`: cada ferramenta é `kompres.register('nome', (signal, document) => {...})`. Imagem: `compressor.js`, `resizer.js`, `background-remover.js`, `rotate.js`, `crop.js`, `watermark.js`. PDF: `pdf.js` (modos merge/compress/images/extract/remove/rotate/export/watermark/number/crop, operações em `pdf-tools.js`) e `pdf-organize.js` (organizar páginas). `document` é restrito à página; `signal` aborta ao sair. Compartilhados: `input.js` (arrastar em qualquer lugar + colar), `png-client.js` (PNG otimizado via worker), `theme.js`, `selects.js`, `privacy.js`.
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
- **Lote de 27/10/2026, segunda parte (branch `ajustes-pos-publicacao`):** filtro por categoria nos cartões; melhorar com IA (carregamento com desfoque e círculo, comparação antes/depois só no fim); desfocar (retângulo e oval); HEIC para JPG/PNG; favicon ICO; criar GIF; assinar PDF; PDF para texto; câmera no Imagens → PDF; páginas JPG→PNG, PNG→WebP, JPG→WebP e PNG→PDF; marca d'água arrastável em imagem e PDF. Ferramentas com editor de um arquivo usam `.tool-stage` (oculto até carregar), que liga o quadro de pré-visualização e o "+" do CSS comum. Para criar ferramenta nova, siga `docs/criar-ferramenta.md`.
- **Ferramentas novas (27/10/2026):** PDF marca d'água, numerar, recortar margens (modos do `pdf.js`) e organizar páginas (`pdf-organize.js`); imagem girar/espelhar (rotação acumulada por imagem, botões Esquerda/Direita como no iLoveIMG), recortar (caixa com alças e proporções), marca d'água (texto ou logo, grade 3×3 ou mosaico) e SVG → PNG (o compressor aceita `.svg`, campo "Largura do SVG rasterizado"). Cada uma tem página própria registrada em `pages.ts` e cartão em `tools.ts`.
- **Quadro da ferramenta em duas colunas (desktop ≥901px):** cada ferramenta tem `.tool-workspace` com `.tool-side` (ajustes e botões, à esquerda, fixa ao rolar) e `.tool-main` (área de arrastar e pré-visualização, à direita). O quadro ocupa quase a largura da janela (até 1680px). No celular as duas colunas se dissolvem com `display: contents` e a ordem vem de `order` (CSS no fim de `style.css`). Ao criar uma ferramenta nova, usar a mesma estrutura.
- **Padrão de pré-visualização:** depois que há arquivos, a área de arrastar vira uma faixa fina e os resultados ficam em cartões grandes centralizados (uma imagem só: até 520px), miniatura quadrada com `object-fit: contain` sobre quadriculado. Compressor com qualidade padrão de 80%.
- **Download em lote (`public/js/downloads.js`):** com mais de um resultado, o botão vira "Baixar todas" (arquivos separados, padrão) e ganha uma setinha com "Salvar numa pasta" (Chrome/Edge no computador) e "Baixar ZIP"; a escolha fica no `localStorage` (`kompres-download`). Usado no compressor, redimensionar, girar, marca d'água, HEIC e remover fundo. Motivo: o dono (e provavelmente outras pessoas) baixava cartão por cartão para não receber ZIP.
- **SEO, compartilhamento e GEO:** cada página tem imagem de compartilhamento própria em `/og/<slug>.png`, gerada no build por `src/pages/og/[slug].png.ts` com o sharp e as fontes em `src/assets/og-fonts` (Syne e Inter, OFL); textos em `src/data/og.ts`. O sharp é devDependency, então o build da Netlify precisa instalar devDependencies (padrão; não definir `NODE_ENV=production`). Dados estruturados ligados por `@id` (WebSite, Organization, WebApplication por página, ItemList com todas as ferramentas na home, breadcrumbs). `/llms.txt` gerado do registro de páginas para assistentes com IA. Lista "Todas as ferramentas" separada em Imagem e PDF no fim de cada página e na 404 (ajuda o Google a montar sitelinks, que ele decide sozinho).
- **Páginas de erro:** `404.astro` gera `404.html` (noindex, com todas as ferramentas); a Netlify serve esse arquivo com status 404 sozinha. Site estático não tem 403 nem 500 próprios: a Netlify não permite página 403 personalizada.
- **pdf.js renderiza com `intent: 'print'`** (miniaturas, exportar, comprimir, organizar): o modo padrão usa `requestAnimationFrame` e trava quando a aba está em segundo plano.
- Navegação entre ferramentas em **cartões com ícone e descrição** (`src/components/ToolsNav.astro`, dados em `src/data/tools.ts`, estilo em `tool-navigation.css`), para imagem e PDF. No PDF, os cartões levam às páginas de cada modo e o seletor "Ferramenta" dentro do formulário foi removido (`pdf.js` lê o modo de `#pdfControls[data-mode]`). Celular: faixa com rolagem horizontal e cartão ativo centralizado (`app.ts`).

Remover fundo e PDF continuam com botão (de propósito: modelo de IA pesado; juntar depende da ordem).

## O que fazer agora

1. Na pasta do projeto: `npm install` e `npm run dev` (Astro 7 deixa o servidor em segundo plano; `npx astro dev status` / `npx astro dev logs`). Abrir http://localhost:4321/.
2. O João vai avaliar as mudanças acima. Se ele pedir ajustes (por exemplo, voltar o processamento manual), fazer no mesmo branch.
3. Só depois da aprovação: abrir PR para `main` e fazer merge. **Cada PR gera um Deploy Preview e cada merge um deploy de produção na Netlify; os créditos do João estão acabando.** Agrupar mudanças, um push por PR, testar tudo localmente antes. Sugestão pendente: desligar Deploy Previews automáticos no painel da Netlify e, no próximo deploy, adicionar uma regra `ignore` no `netlify.toml`.
4. Depois do deploy: no Google Search Console, reenviar o sitemap e pedir indexação das páginas novas (`/pdf/girar/`, `/pdf/remover-paginas/`, `/pdf/marca-dagua/`, `/pdf/numerar/`, `/pdf/recortar/`, `/pdf/organizar/`, `/pdf/assinar/`, `/pdf/pdf-para-texto/`, `/pdf/png-para-pdf/`, `/girar/`, `/recortar/`, `/marca-dagua/`, `/desfocar/`, `/melhorar-imagem/`, `/criar-gif/`, `/converter/svg-para-png/`, `/converter/heic-para-jpg/`, `/converter/png-para-ico/`, `/converter/jpg-para-png/`, `/converter/png-para-webp/`, `/converter/jpg-para-webp/`) e das que ficaram da lista anterior (`/converter/png-para-jpg/`, `/pdf/pdf-para-jpg/`, `/pdf/dividir/`, `/converter/webp-para-png/`, `/`). Em 2 a 4 semanas, exportar o relatório de Desempenho para ajustar textos.

## Como testar

- `npm run build` gera `dist/`; servir com `npx astro preview` ou `python -m http.server` dentro de `dist/`.
- Testes de ponta a ponta foram feitos com Playwright (Chromium) simulando arrastar, colar, downloads e lendo os PDFs gerados com pdf-lib. Os scripts ficaram num diretório temporário da sessão na nuvem e não estão no repositório; se precisar, recriar: suítes de regressão (ferramentas, páginas de SEO, navegação sem recarregar, tema, cookies) e de usabilidade (automático ao soltar, colar, modos novos, girar, remover).
- Auditoria de SEO da build: 1 H1 por página, título ≤ 62, descrição ≤ 160, canonical, sitemap completo, sem links quebrados.
- O remover fundo processando uma imagem de verdade nunca foi testado automaticamente (modelo externo). Vale testar no navegador.
- Para testar sem arquivos reais no painel do navegador: gerar PDFs com o `PDFLib` da própria página (ou imagens com canvas), criar um `File`, colocar num `DataTransfer` e atribuir a `input.files` + evento `change`. O download pode ser capturado trocando `HTMLAnchorElement.prototype.click`.

## Decisões já tomadas (não reabrir sem motivo)

- Sem React/SPA pura: Astro estático mantém SEO e peso baixo; `ClientRouter` dá a fluidez.
- Sem prerender via Speculation Rules (executaria o analytics em páginas não visitadas).
- Sem `FAQPage` em JSON-LD (Google não mostra mais para sites comuns).
- `/resizer/` continua com esse nome (mudar exigiria redirect 301).
- Sem rolagem suave: é ferramenta, não landing page.

## Analytics

Dois sistemas: Google Analytics (só com aceite no aviso de cookies, `privacy.js`) e **Trackik** (projeto próprio do João, repositório `joaoa21/analytics-hub`, script `t.js` servido pela API no Railway). O Trackik conta navegações sem recarregar (intercepta `pushState`) e, desde o PR #6 do analytics-hub, grava o título certo nessas navegações. Áreas com nomes de arquivos usam `data-ah-mask` para não enviar texto. Nomes em "Mais clicados": o Trackik usa `data-ah-label`, texto de botões/links, `aria-label` e o `<label>` dos campos (joaoa21/trackik#22). No Kompres, as colunas (`Coluna de ajustes`, `Área de pré-visualização`), a seção (`Área da ferramenta`), as grades de resultado (`Cartão de resultado`), os botões dos cartões, os cartões de navegação e os controles deslizantes com valor no rótulo têm `data-ah-label`.
