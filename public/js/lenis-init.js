if (window.Lenis && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
const lenis = new Lenis({
  duration: 1,
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 1,
  smoothTouch: false,
  infinite: false
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

// Navegação sem recarregar: interrompe a rolagem em andamento antes da troca de página
// e recalcula a altura depois, para não "puxar" a página nova para a posição antiga.
document.addEventListener('astro:before-preparation', () => lenis.stop());
document.addEventListener('astro:after-swap', () => { lenis.start(); lenis.resize(); });
}
