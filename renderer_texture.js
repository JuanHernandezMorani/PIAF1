window.PIAF_MODE = 'texture';
(function attachRenderer() {
  const script = document.createElement('script');
  script.src = 'renderer.js';
  script.defer = true;
  document.head.appendChild(script);
})();

