(() => {
  let imported = false;

  const boot = () => {
    if (imported) {
      return;
    }

    if (!document.documentElement) {
      window.requestAnimationFrame(boot);
      return;
    }

    imported = true;
    import(chrome.runtime.getURL("src/content/main.js")).catch((error) => {
      console.error("[ktv420] Failed to boot extension", error);
    });
  };

  boot();
})();
