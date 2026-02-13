(function (global) {
  'use strict';

  function getTextLength(el) {
    if (!el) return 0;
    var text = el.innerText || el.textContent || '';
    return text.trim().length;
  }

  function pickCandidate(doc) {
    var candidates = [];
    var selectors = ['article', 'main', '[role="main"]', '.article', '.post', '.entry'];
    selectors.forEach(function (sel) {
      var nodes = Array.prototype.slice.call(doc.querySelectorAll(sel));
      nodes.forEach(function (node) {
        candidates.push(node);
      });
    });
    if (candidates.length === 0) {
      candidates = Array.prototype.slice.call(doc.body ? doc.body.children : []);
    }
    var best = null;
    var bestScore = 0;
    candidates.forEach(function (node) {
      var score = getTextLength(node);
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    });
    return best;
  }

  function Readability(doc, options) {
    this._doc = doc;
    this._options = options || {};
  }

  Readability.prototype.parse = function () {
    var doc = this._doc;
    if (!doc || !doc.body) {
      return null;
    }
    var candidate = pickCandidate(doc);
    var text = '';
    if (candidate) {
      text = candidate.innerText || candidate.textContent || '';
    } else {
      text = doc.body.innerText || doc.body.textContent || '';
    }
    var title = doc.title || '';
    return {
      title: title,
      textContent: text.trim()
    };
  };

  global.Readability = Readability;
})(window);
