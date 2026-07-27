window.MathJax = {
  tex: {
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    processEscapes: true,
    processEnvironments: true,
    macros: {
      overarc: ["\\overset{\\frown}{#1}", 1]
    }
  },
  startup: {
    typeset: false
  },
  chtml: {
    displayAlign: "left",
    displayIndent: "0"
  },
  options: {
    skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
  }
};
