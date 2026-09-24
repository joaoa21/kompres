// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kompres.com.br',
  // Mantém as URLs atuais: /resizer/, /pdf/, /remover-fundo/
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Baixa o HTML da próxima ferramenta ao passar o mouse no link.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
});
