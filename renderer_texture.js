window.PIAF_MODE = 'texture';
(function attachRenderer() {
  const script = document.createElement('script');
  script.src = 'renderer.js';
  script.defer = true;
  document.head.appendChild(script);
})();

if (!window.__PIAF_ERROR_BOUND__) {
  window.__PIAF_ERROR_BOUND__ = true;
  window.addEventListener('error', event => {
    console.error('🚨 [GLOBAL ERROR]', event.error);
    if (typeof Swal !== 'undefined' && Swal?.fire) {
      Swal.fire({
        title: 'Error inesperado',
        html: `<pre>${event.error?.message || 'Error desconocido'}</pre>`,
        icon: 'error',
        confirmButtonText: 'Cerrar'
      });
    }
  });

  window.addEventListener('unhandledrejection', event => {
    console.error('🚨 [UNHANDLED PROMISE]', event.reason);
    if (typeof Swal !== 'undefined' && Swal?.fire) {
      Swal.fire({
        title: 'Error en promesa',
        html: `<pre>${event.reason?.message || 'Error no manejado'}</pre>`,
        icon: 'error',
        confirmButtonText: 'Cerrar'
      });
    }
  });
}

