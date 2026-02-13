(function () {
  'use strict';

  var STORAGE_KEY = 'simple_reader_rate';
  var DEFAULT_RATE = 1.0;
  var minRate = 0.5;
  var maxRate = 2.0;
  var stepRate = 0.1;

  var state = {
    isSpeaking: false,
    isPaused: false,
    rate: DEFAULT_RATE,
    utterance: null
  };

  function getStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.sync) return browser.storage.sync;
    return null;
  }

  function loadRate() {
    var storage = getStorage();
    if (!storage) return Promise.resolve(DEFAULT_RATE);
    return new Promise(function (resolve) {
      storage.get([STORAGE_KEY], function (result) {
        var value = result && result[STORAGE_KEY];
        resolve(typeof value === 'number' ? value : DEFAULT_RATE);
      });
    });
  }

  function saveRate(rate) {
    var storage = getStorage();
    if (!storage) return;
    var payload = {};
    payload[STORAGE_KEY] = rate;
    storage.set(payload, function () {});
  }

  function ensureUi() {
    if (document.getElementById('simple-reader-bar')) return;

    var bar = document.createElement('div');
    bar.id = 'simple-reader-bar';
    bar.innerHTML =
      '<div class="simple-reader-title">Reader</div>' +
      '<div class="simple-reader-controls">' +
        '<button id="simple-reader-play" title="Play/Pause">Play</button>' +
        '<button id="simple-reader-stop" title="Stop">Stop</button>' +
      '</div>' +
      '<div class="simple-reader-rate">' +
        '<span id="simple-reader-rate-label"></span>' +
        '<input id="simple-reader-rate" type="range" min="' + minRate + '" max="' + maxRate + '" step="' + stepRate + '">' +
      '</div>' +
      '<div id="simple-reader-msg" class="simple-reader-msg"></div>';

    document.body.appendChild(bar);

    var playBtn = document.getElementById('simple-reader-play');
    var stopBtn = document.getElementById('simple-reader-stop');
    var rateInput = document.getElementById('simple-reader-rate');
    var rateLabel = document.getElementById('simple-reader-rate-label');
    var msg = document.getElementById('simple-reader-msg');

    function setMessage(text) {
      msg.textContent = text || '';
    }

    function updateRateUi(rate) {
      rateInput.value = String(rate);
      rateLabel.textContent = rate.toFixed(1) + 'x';
    }

    function setPlayLabel() {
      if (state.isSpeaking && !state.isPaused) {
        playBtn.textContent = 'Pause';
      } else if (state.isPaused) {
        playBtn.textContent = 'Resume';
      } else {
        playBtn.textContent = 'Play';
      }
    }

    function stopSpeaking() {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
      }
      state.isSpeaking = false;
      state.isPaused = false;
      state.utterance = null;
      setPlayLabel();
    }

    function speakText(text) {
      stopSpeaking();
      if (!text || !text.trim()) {
        setMessage('No readable text found.');
        return;
      }
      setMessage('');
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = state.rate;
      utterance.onend = function () {
        state.isSpeaking = false;
        state.isPaused = false;
        state.utterance = null;
        setPlayLabel();
      };
      utterance.onerror = function () {
        setMessage('Speech failed.');
        state.isSpeaking = false;
        state.isPaused = false;
        state.utterance = null;
        setPlayLabel();
      };
      state.utterance = utterance;
      state.isSpeaking = true;
      state.isPaused = false;
      setPlayLabel();
      speechSynthesis.speak(utterance);
    }

    playBtn.addEventListener('click', function () {
      if (state.isSpeaking && !state.isPaused) {
        speechSynthesis.pause();
        state.isPaused = true;
        setPlayLabel();
        return;
      }
      if (state.isSpeaking && state.isPaused) {
        speechSynthesis.resume();
        state.isPaused = false;
        setPlayLabel();
        return;
      }
      var getText = window.__simpleReaderGetText;
      var text = typeof getText === 'function' ? getText() : '';
      speakText(text);
    });

    stopBtn.addEventListener('click', function () {
      stopSpeaking();
    });

    rateInput.addEventListener('input', function (e) {
      var newRate = parseFloat(e.target.value);
      state.rate = newRate;
      updateRateUi(newRate);
      saveRate(newRate);
      if (state.utterance) {
        state.utterance.rate = newRate;
      }
    });

    loadRate().then(function (rate) {
      state.rate = rate;
      updateRateUi(rate);
    });

    setPlayLabel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi);
  } else {
    ensureUi();
  }
})();
