// Tavern Crashers — boot. All window.* globals are defined by the plain
// scripts loaded before this one (see index.html load order); we mount once
// React, the engine, and every component are present.
(function(){
  function boot(){
    if (window.App && window.MapTabs && window.Stage && window.MapEngine){
      ReactDOM.createRoot(document.getElementById("root"))
        .render(React.createElement(window.App));
    } else {
      setTimeout(boot, 30);
    }
  }
  boot();
})();
