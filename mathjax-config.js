window.MathJax = {
  tex: {
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    processEscapes: true,
    macros: {
      overarc: ["\\overset{\\frown}{#1}", 1]
    }
  },
  chtml: {
    displayAlign: "left",
    displayIndent: "0"
  },
  options: {
    skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
  }
};
