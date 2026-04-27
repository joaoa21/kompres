(function initTheme() {
  const saved = localStorage.getItem('kompres-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isLight = saved ? saved === 'light' : !prefersDark;

  if (isLight) {
    document.documentElement.classList.add('light');
  }
})();

function setThemeColor() {
  const isLight = document.documentElement.classList.contains('light');
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute('media') || '';
    if (isLight && media.includes('light')) meta.setAttribute('content', '#f2f0eb');
    if (!isLight && media.includes('dark')) meta.setAttribute('content', '#0c0c0d');
  });
}

function updateAllRangeFills() {
  document.querySelectorAll('input[type="range"]').forEach((range) => {
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    const value = Number(range.value || 0);
    const pct = ((value - min) / (max - min)) * 100;
    const track = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim();
    const fill = document.documentElement.classList.contains('light') ? '#3d7000' : '#b8f55a';
    range.style.background = `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, ${track} ${pct}%, ${track} 100%)`;
  });
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('kompres-theme', isLight ? 'light' : 'dark');
  setThemeColor();
  updateAllRangeFills();
}

window.toggleTheme = toggleTheme;
window.updateAllRangeFills = updateAllRangeFills;

const themeSwitch = document.getElementById('theme-switch');
if (themeSwitch) {
  themeSwitch.addEventListener('click', toggleTheme);
}

setThemeColor();
updateAllRangeFills();
