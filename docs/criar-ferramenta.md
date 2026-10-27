# Como criar uma ferramenta no Kompres

Projeto: `C:\Users\joaoa\OneDrive\Área de Trabalho\Arquivos\Dev\kompres` — Astro 7 estático, ferramentas de imagem e PDF que rodam 100% no navegador (nada é enviado a servidor). Idioma de interface, textos e comentários: **português do Brasil**. Leia `CONTEXTO.md` antes.

## Peças compartilhadas
- `src/data/pages.ts` (registro: título, descrição, `path`), `src/data/tools.ts` (cartões de navegação; `ToolKey` = chave de `pages`), `src/data/og.ts`, `src/layouts/Base.astro`, `src/layouts/CompressorPage.astro`, `src/scripts/app.ts`, `public/css/style.css`, `public/css/tool-navigation.css`, `public/js/input.js`, `public/js/png-client.js`, `public/js/theme.js`. São compartilhados por todas as ferramentas: mexa neles só quando a mudança vale para todas.
- Antes de criar a página, registre a rota em `src/data/pages.ts`, o cartão (com categoria) em `src/data/tools.ts` e o texto da imagem de compartilhamento em `src/data/og.ts`. Sitemap, `llms.txt`, imagem OG e links "Todas as ferramentas" saem daí sozinhos.
- Valide com `node --check arquivo.js`, `npm run build` e teste no navegador com arquivos gerados na própria página (canvas ou `PDFLib`, injetados num `DataTransfer` atribuído a `input.files`).

## Como uma ferramenta funciona
- Script em `public/js/<nome>.js`: `kompres.register('<nome>', (signal, document) => { ... })`. `document` é um Proxy restrito à página (use `document.getElementById`/`querySelector`); `signal` aborta ao navegar para outra página: todo listener em `document`/`window` recebe `{ signal }`, e no `signal.addEventListener('abort', ...)` libere object URLs, bitmaps, workers.
- Entrada de arquivos: `kompres.fileDrop({ signal, document, zone, onFiles })` (arrastar em qualquer ponto e colar com Ctrl+V) + o `<input type="file">` dentro da `.drop-zone`. Arquivo não suportado → mensagem em `.tool-status` (`hidden` quando vazio).
- PNG sem perdas otimizado: `await kompres.pngFromCanvas(canvas, 1)`. JPEG: `canvas.toBlob(cb, 'image/jpeg', q)` sobre fundo branco. Decodifique imagens com `createImageBitmap(file, { imageOrientation: 'from-image' })` (respeita EXIF).
- Download: um arquivo → direto; vários → ZIP com JSZip (`<script is:inline slot="libs" src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>`).
- Bibliotecas externas: só de `cdnjs.cloudflare.com` ou `cdn.jsdelivr.net/npm/` com **versão exata** (confira que existe: `curl -sI <url>` deve dar 200). Carregue sob demanda quando for pesada.
- Elementos que mostram nome de arquivo do usuário levam `data-ah-mask` (privacidade do analytics).
- Nomes no analytics (cartão "Mais clicados" do Trackik): botões só com ícone precisam de `aria-label`, campos de `<label for>`; onde o texto não serve (rótulo com valor, como "Intensidade 50%"; botões gerados dentro de `data-ah-mask`), use `data-ah-label="Nome"`. A `.tool-side`, a `.tool-main` e a `.tool-section` já levam `data-ah-label` (copie da página modelo).

## Página (`src/pages/.../index.astro`)
Use como modelo `src/pages/girar/index.astro` (ferramenta de imagem em lote) ou `src/pages/recortar/index.astro` (editor de uma imagem). Estrutura obrigatória:

```astro
<Base page={pages.CHAVE} section="image|pdf" activeTool="CHAVE" tool="<nome>" styles={['/css/<nome>.css?v=1']}>
  <Hero title="..." highlight="..." text="..." />            <!-- único h1 -->
  <section class="tool-section page2">
    <div class="tool-header page-inner"><div><h2>...</h2><p>...</p></div></div>
    <div class="tool-workspace page-inner">
      <div class="tool-side">                                  <!-- coluna esquerda no desktop -->
        <div class="controls page-inner">  ...control-group...  </div>
        <div class="action-bar page-inner"> botão .btn.btn-primary + .btn.btn-outline </div>
      </div>
      <div class="tool-main">                                  <!-- coluna direita: pré-visualização -->
        <p class="tool-status page-inner" id="..." role="status" aria-live="polite" hidden></p>
        <div class="drop-zone page-inner" id="..."><input type="file" ...><span class="drop-icon">⬇</span><p><strong>Arraste ... aqui</strong><br>ou clique para selecionar · FORMATOS<br><span class="drop-hint">Também dá para colar com Ctrl+V</span></p></div>
        <!-- Lote: <div class="image-grid page-inner" data-ah-mask></div> com cartões .image-card (ver girar).
             Editor de um arquivo: <div class="tool-stage page-inner" hidden> ... </div>; tire o hidden quando o arquivo carregar. -->
      </div>
    </div>
  </section>
  <Guide title="Como ..." current={pages.CHAVE.path} faqs={[ 5 a 6 perguntas úteis e específicas; HTML permitido com links internos ]} />
  <script slot="scripts" is:inline src="/js/<nome>.js?v=1"></script>
</Base>
```
- O CSS compartilhado já faz: no desktop (≥901px) duas colunas (ajustes à esquerda, pré-visualização grande à direita); no celular uma coluna. Quando há `.image-grid > *` ou `.tool-stage:not([hidden])`, a área de arrastar vira um botão "+" verde e a coluna da direita vira um "palco". Não recrie isso.
- Classes prontas em `style.css`: `.control-group` (com `<label>`), `.format-toggle` + `.fmt-btn` (rádios dentro de `label.fmt-btn`), `.field-hint`, `.btn`, `.btn-primary`, `.btn-outline`, `.image-grid`, `.image-card`, `.card-thumb-wrap`, `.card-thumb`, `.card-body`, `.card-name`, `.card-remove`, `.card-download`, `.stats-bar`, `.hidden`. `input[type=range]` já é estilizado (o preenchimento verde é automático).
- Processamento automático ao soltar os arquivos e ao mudar ajustes (quando fizer sentido), como em `public/js/rotate.js` / `resizer.js`.
- CSS próprio em `public/css/<nome>.css`, só variáveis de tema (`--bg --surface --surface2 --border --border-hover --accent --accent-dim --text --muted`); tema claro via `html.light` (destaque como texto/borda: `#3d7000`). Precisa funcionar no celular (≤768px) e sem rolagem horizontal.
- Acessibilidade: `aria-label` em botões só com ícone, foco visível, textos de status em `role="status"`.
- Sem bibliotecas além das indicadas na tarefa. Código limpo, comentários curtos em português explicando o porquê.

