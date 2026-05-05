// webrtc-doorbell-card v0.4
//
// A Lovelace card that wraps AlexxIT's `webrtc-camera` and adds proper
// answer/end-call buttons that toggle BOTH directions of audio at once
// (incoming via video.muted, outgoing via mic track .enabled), plus an
// optional unlock button that fires a configurable HA action.
//
// Repository: https://github.com/naps62/ha-webrtc-doorbell-card

(() => {
  if (window.__webrtcDoorbellPatchInstalled) return;
  window.__webrtcDoorbellPatchInstalled = true;
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async function (constraints) {
    const stream = await orig(constraints);
    if (constraints && constraints.audio) {
      window.__webrtcDoorbellMicStream = stream;
      // Start disabled — user clicks Answer to enable
      stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
    return stream;
  };
})();

const VERSION = '0.6.0';

class WebrtcDoorbellCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('entity is required');
    }
    this._config = config;
    if (!this._rendered) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
  }

  async _render() {
    this._rendered = true;
    this.innerHTML = '';
    this.style.cssText = 'display:block;width:100%;height:100%;';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;height:100%;';
    this.appendChild(wrap);

    const helpers = await window.loadCardHelpers();
    const inner = helpers.createCardElement({
      type: 'custom:webrtc-camera',
      entity: this._config.entity,
      media: 'video,audio,microphone',
      mode: this._config.mode || 'webrtc',
      ui: false,
      background: true,
    });
    if (this._hass) inner.hass = this._hass;
    this._inner = inner;
    this._appendInner(wrap, inner);

    this._buildVideoLayout(wrap);

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'left:0', 'right:0',
      // Pin to bottom of viewport, respecting iOS home-indicator / Android nav-bar safe areas
      'bottom:max(24px, env(safe-area-inset-bottom, 24px))',
      'padding-left:env(safe-area-inset-left, 0)',
      'padding-right:env(safe-area-inset-right, 0)',
      'display:flex', 'justify-content:center', 'gap:24px',
      'z-index:10', 'pointer-events:none',
    ].join(';');
    wrap.appendChild(overlay);

    if (this._config.unlock_action) {
      this._unlockBtn = this._makeBtn(
        this._config.unlock_icon || 'mdi:key',
        'rgba(0,0,0,0.55)',
        () => this._unlock(),
      );
      this._unlockIcon = this._unlockBtn.querySelector('ha-icon');
      overlay.appendChild(this._unlockBtn);
    }

    this._answerBtn = this._makeBtn('mdi:phone', '#15803d', () => this._answer());
    this._endBtn = this._makeBtn('mdi:phone-hangup', '#b91c1c', () => this._end());
    this._endBtn.style.display = 'none';
    overlay.appendChild(this._answerBtn);
    overlay.appendChild(this._endBtn);

    this._waitForVideo().then((v) => {
      if (!v) return;
      v.muted = true;
      this._sourceVideo = v;
      const layout = this._config.layout || 'split';
      if (layout === 'split') {
        // Hidden inner video drives WebRTC; mirror its srcObject onto our
        // display videos. Poll because srcObject can change on reconnect
        // without firing observable events.
        this._mirrorStream();
        this._mirrorInterval = setInterval(() => this._mirrorStream(), 1000);
      } else {
        // Single-video layout — apply object-fit override directly.
        const fit = this._config.object_fit || (layout === 'contain' ? 'contain' : 'cover');
        v.style.objectFit = fit;
        v.style.width = '100%';
        v.style.height = '100%';
      }
    });
  }

  // Hide or show the inner card depending on layout. For 'split' we keep it
  // off-screen but rendered (so the connection stays alive). For other layouts
  // we let it render full-size and skip the mirror.
  _appendInner(wrap, inner) {
    const layout = this._config.layout || 'split';
    if (layout === 'split') {
      const cage = document.createElement('div');
      cage.style.cssText = [
        'position:absolute', 'left:0', 'top:0',
        'width:1px', 'height:1px',
        'opacity:0', 'pointer-events:none',
        'overflow:hidden',
      ].join(';');
      cage.appendChild(inner);
      wrap.appendChild(cage);
    } else {
      inner.style.cssText = 'display:block;width:100%;height:100%;';
      wrap.appendChild(inner);
    }
  }

  _buildVideoLayout(wrap) {
    const layout = this._config.layout || 'split';
    if (layout !== 'split') return;

    const stack = document.createElement('div');
    stack.style.cssText = [
      'position:absolute', 'inset:0',
      'display:flex', 'flex-direction:column',
      'background:black',
    ].join(';');
    wrap.appendChild(stack);

    const mkVideo = (objectFit, flexBasis) => {
      const v = document.createElement('video');
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.style.cssText = [
        `flex:${flexBasis}`,
        'width:100%', 'min-height:0',
        `object-fit:${objectFit}`,
        'background:black',
      ].join(';');
      return v;
    };

    // Top: full uncropped frame (see the sides). Bottom: cover crop (fills width).
    this._topVideo = mkVideo('contain', '0 0 40%');
    this._bottomVideo = mkVideo('cover', '1 1 60%');
    stack.appendChild(this._topVideo);
    stack.appendChild(this._bottomVideo);
  }

  _mirrorStream() {
    const src = this._sourceVideo;
    if (!src) return;
    const stream = src.srcObject;
    if (!stream) return;
    if (this._topVideo && this._topVideo.srcObject !== stream) {
      this._topVideo.srcObject = stream;
      this._topVideo.play?.().catch(() => {});
    }
    if (this._bottomVideo && this._bottomVideo.srcObject !== stream) {
      this._bottomVideo.srcObject = stream;
      this._bottomVideo.play?.().catch(() => {});
    }
  }

  disconnectedCallback() {
    clearInterval(this._mirrorInterval);
    this._mirrorInterval = null;
  }

  _makeBtn(icon, bg, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = [
      `background:${bg}`,
      'border:none', 'color:white',
      'width:72px', 'height:72px', 'border-radius:50%',
      'cursor:pointer', 'pointer-events:auto',
      'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
      '-webkit-tap-highlight-color:transparent',
      'transition:transform 120ms ease',
      'padding:0',
    ].join(';');
    const ic = document.createElement('ha-icon');
    ic.icon = icon;
    ic.style.cssText = '--mdc-icon-size:36px;color:white;pointer-events:none;';
    btn.appendChild(ic);
    btn.addEventListener('pointerdown', () => { btn.style.transform = 'scale(0.9)'; });
    const release = () => { btn.style.transform = ''; };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  _unlock() {
    const action = this._config.unlock_action;
    if (!action || !this._hass) return;

    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    this._fireAction(action);
    this._flashUnlock();
  }

  _fireAction(action) {
    // Minimal action dispatcher — supports the common shapes used in HA
    // tap_action configs. Only `call-service` / `perform-action` is wired
    // up; other actions are dispatched as a hass-action DOM event so HA's
    // own action handlers can pick them up if available.
    const type = action.action || action.service ? 'call-service' : null;
    if ((action.action === 'call-service' || action.action === 'perform-action' || (!action.action && action.service))) {
      const svc = action.service || action.perform_action;
      if (!svc) return;
      const [domain, name] = svc.split('.');
      const data = action.data || action.service_data || {};
      const target = action.target || {};
      this._hass.callService(domain, name, data, target);
      return;
    }

    // Fallback: dispatch a hass-action event the way HA expects
    const event = new Event('hass-action', { bubbles: true, composed: true });
    event.detail = { config: { tap_action: action }, action: 'tap' };
    this.dispatchEvent(event);
  }

  _flashUnlock() {
    const btn = this._unlockBtn;
    const icon = this._unlockIcon;
    if (!btn || !icon) return;
    const origBg = 'rgba(0,0,0,0.55)';
    const origIcon = this._config.unlock_icon || 'mdi:key';

    icon.icon = 'mdi:check-bold';
    btn.style.backgroundColor = '#15803d';
    btn.animate(
      [
        { transform: 'scale(0.9)', offset: 0 },
        { transform: 'scale(1.18)', offset: 0.35 },
        { transform: 'scale(1)', offset: 1 },
      ],
      { duration: 700, easing: 'ease-out' },
    );

    clearTimeout(this._unlockResetTimer);
    this._unlockResetTimer = setTimeout(() => {
      btn.style.backgroundColor = origBg;
      icon.icon = origIcon;
    }, 1000);
  }

  async _waitForVideo() {
    for (let i = 0; i < 60; i++) {
      const v = this._findVideo();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  _findVideo() {
    if (!this._inner) return null;
    return (
      this._inner.querySelector?.('video') ||
      this._inner.shadowRoot?.querySelector?.('video') ||
      null
    );
  }

  _setActive(active) {
    // In split layout the source video is hidden and we mirror its stream onto
    // display videos. Keep the source muted so audio comes from exactly one
    // visible video (the bottom one). Outside split layout the source video
    // *is* the visible one, so we toggle that.
    const split = (this._config.layout || 'split') === 'split';
    if (split) {
      if (this._sourceVideo) this._sourceVideo.muted = true;
      if (this._bottomVideo) this._bottomVideo.muted = !active;
    } else if (this._sourceVideo) {
      this._sourceVideo.muted = !active;
    }
    const stream = window.__webrtcDoorbellMicStream;
    if (stream) {
      stream.getAudioTracks().forEach((t) => { t.enabled = active; });
    }
  }

  _answer() {
    if (navigator.vibrate) navigator.vibrate(30);
    this._setActive(true);
    this._answerBtn.style.display = 'none';
    this._endBtn.style.display = 'flex';
  }

  _end() {
    if (navigator.vibrate) navigator.vibrate(30);
    this._setActive(false);
    this._answerBtn.style.display = 'flex';
    this._endBtn.style.display = 'none';
  }

  getCardSize() { return 6; }
  static getStubConfig() { return { entity: 'camera.doorbell' }; }
}

if (!customElements.get('webrtc-doorbell-card')) {
  customElements.define('webrtc-doorbell-card', WebrtcDoorbellCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === 'webrtc-doorbell-card')) {
  window.customCards.push({
    type: 'webrtc-doorbell-card',
    name: 'WebRTC Doorbell',
    description: 'Doorbell with answer/end call (toggles both audio directions)',
    documentationURL: 'https://github.com/naps62/ha-webrtc-doorbell-card',
  });
}

console.info(
  `%c WEBRTC-DOORBELL-CARD %c v${VERSION} `,
  'color:white;background:#15803d;font-weight:700',
  'color:#15803d;background:white;font-weight:700',
);
