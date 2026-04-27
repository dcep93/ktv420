(() => {
  let imported = false;

  const boot = () => {
    if (imported) {
      return;
    }

    imported = true;
    window.setTimeout(() => {
      import(chrome.runtime.getURL("src/content/main.js")).catch((error) => {
        console.error("[ktv420] Failed to boot extension", error);
      });
    }, 1000);
  };

  if (document.readyState === "complete") {
    boot();
  } else {
    window.addEventListener("load", boot, { once: true });
  }
})();
