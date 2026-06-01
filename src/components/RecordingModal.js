// Tavern Crashers — Recording playback modal (in-app video + download)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function RecordingModal({ clip, onClose }){
  return React.createElement("div", {
    className:"modal-bg", onMouseDown: (e)=>{ if (e.target === e.currentTarget) onClose(); }
  },
    React.createElement("div", { className:"modal rec-modal" },
      React.createElement("div", { className:"rec-modal-head" },
        React.createElement("h3", null, "Round recorded"),
        React.createElement("button", { className:"rec-x", onClick:onClose, title:"Close" }, "×")
      ),
      React.createElement("video", {
        className:"rec-video",
        src: clip.url,
        controls: true, autoPlay: true, loop: true, playsInline: true,
      }),
      React.createElement("p", { className:"rec-hint" },
        "Click play to review. Download saves a ", React.createElement("b", null, ".webm"),
        " video file you can share or drop into any editor."),
      React.createElement("div", { className:"row" },
        React.createElement("button", { className:"insp-btn", onClick:onClose, style:{width:"auto"} }, "Close"),
        React.createElement("a", {
          className:"insp-btn primary", href: clip.url, download: clip.name,
          style:{ width:"auto", textDecoration:"none" }
        }, "⤓  Download video")
      )
    )
  );
}

  window.RecordingModal = RecordingModal;
})();
