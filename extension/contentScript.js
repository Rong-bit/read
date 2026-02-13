(function () {
  'use strict';

  function getSelectionText() {
    var selection = window.getSelection && window.getSelection();
    if (!selection) return '';
    var text = selection.toString();
    return text.trim();
  }

  function getReadableText() {
    var selected = getSelectionText();
    if (selected) return selected;

    try {
      if (typeof Readability !== 'undefined') {
        var docClone = document.cloneNode(true);
        var reader = new Readability(docClone);
        var article = reader.parse();
        if (article && article.textContent && article.textContent.trim()) {
          return article.textContent.trim();
        }
      }
    } catch (e) {
      // ignore and fall back
    }

    var bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    return bodyText.trim();
  }

  window.__simpleReaderGetText = getReadableText;
})();
