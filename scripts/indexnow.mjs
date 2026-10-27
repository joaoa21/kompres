/**
 * Avisa o Bing (e os outros buscadores do IndexNow, como Yandex e Seznam) de todas as
 * páginas do sitemap. Rodar depois de cada deploy em produção: `npm run indexnow`.
 * A chave precisa estar publicada em https://kompres.com.br/<chave>.txt (public/).
 */
const SITE = 'https://kompres.com.br';
const KEY = '342bce30ece8d6a11b1e5d829a88abfc';

const sitemap = await fetch(`${SITE}/sitemap.xml`).then((res) => res.text());
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!urlList.length) throw new Error('Nenhuma URL no sitemap.');

const keyFile = await fetch(`${SITE}/${KEY}.txt`).then((res) => (res.ok ? res.text() : ''));
if (keyFile.trim() !== KEY) throw new Error(`A chave ainda não está no ar em ${SITE}/${KEY}.txt (falta publicar?).`);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
});
// 200 = recebido; 202 = recebido, chave ainda em validação.
console.log(`IndexNow: ${res.status} ${res.statusText} · ${urlList.length} URLs`);
if (!res.ok) process.exitCode = 1;
