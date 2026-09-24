(() => {
  const banner = document.getElementById('cookie-banner');
  const read = () => { try { return localStorage.getItem('kompres-cookies'); } catch { return null; } };
  function enableAnalytics() {
    if (window.kompresAnalyticsLoaded) return;
    window.kompresAnalyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'G-THHRVK8HJF');
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-THHRVK8HJF';
    document.head.appendChild(script);
  }
  function choose(value) {
    try { localStorage.setItem('kompres-cookies', value); } catch {}
    banner?.classList.remove('show');
    if (value === 'accepted') enableAnalytics();
  }
  window.acceptCookies = () => choose('accepted');
  window.rejectCookies = () => choose('rejected');
  if (read() === 'accepted') enableAnalytics();
  else if (!read()) banner?.classList.add('show');
})();
