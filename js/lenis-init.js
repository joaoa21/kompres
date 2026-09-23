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
}
