# WebRTC Doorbell Card

A Home Assistant Lovelace card that wraps [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC)'s `webrtc-camera` and adds a proper doorbell-style call UX:

- **Answer / Hangup** buttons that toggle *both* directions of audio at once (incoming via `video.muted`, outgoing via the mic track's `enabled` flag) — unlike the bare WebRTC card whose mute button only affects the incoming stream.
- **Configurable unlock button** that fires any HA action (`call-service` / `perform-action`).
- **Haptic + visual feedback** on tap — vibration where supported, scale + flash + checkmark on the unlock button.
- **Mic captured up-front** but kept disabled until you press Answer, so there's no permission prompt mid-call.

## Requirements

- [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC) integration installed (this card delegates the actual WebRTC streaming to its `webrtc-camera` card).
- A camera entity that supports two-way audio via go2rtc (Frigate cameras work, as do Dahua VTOs and many others — see the AlexxIT docs).

## Installation

### HACS (custom repository)

1. HACS → Frontend → ⋮ → Custom repositories
2. Add `https://github.com/naps62/ha-webrtc-doorbell-card`, category **Dashboard**
3. Install **WebRTC Doorbell Card**, then hard-refresh your browser.

### Manual

Copy `webrtc-doorbell-card.js` into `/config/www/` and register it as a Lovelace resource of type `module` pointing at `/local/webrtc-doorbell-card.js`.

## Usage

```yaml
type: custom:webrtc-doorbell-card
entity: camera.doorbell           # any camera that webrtc-camera can stream
unlock_action:                     # optional — omit to hide the unlock button
  action: perform-action
  perform_action: dahua.vto_open_door
  data:
    door_id: 1
  target:
    entity_id: camera.doorbell_main
unlock_icon: mdi:key               # optional, defaults to mdi:key
mode: webrtc                       # optional, passed through to webrtc-camera
top_max_height_vh: 35              # optional, only for layout: split — caps the
                                   # full-frame top section at this many vh units
                                   # (default 35). Lower this if the top half feels
                                   # too dominant on tall portrait screens.
layout: split                      # optional — 'split' (default), 'cover', or 'contain'
                                   #   split:   top half shows the full uncropped frame,
                                   #            bottom half is a center-cropped 'cover' view.
                                   #            One WebRTC connection drives both.
                                   #   cover:   single video, fills viewport (crops sides
                                   #            on portrait phones with landscape cameras).
                                   #   contain: single video, letterboxed to preserve frame.
object_fit: cover                  # optional, only honored with layout: cover/contain
```

A `panel: true` view works best:

```yaml
title: Doorbell
path: doorbell
icon: mdi:doorbell-video
panel: true
cards:
  - type: custom:webrtc-doorbell-card
    entity: camera.doorbell
    unlock_action:
      action: perform-action
      perform_action: dahua.vto_open_door
      data: { door_id: 1 }
      target: { entity_id: camera.doorbell_main }
```

## How it works

The card creates an inner `webrtc-camera` configured with `media: video,audio,microphone` and `ui: false`, then overlays its own three buttons.

- **Mic capture** — a one-time monkey-patch of `navigator.mediaDevices.getUserMedia` stores a reference to the mic stream and starts every audio track disabled. Pressing Answer flips the tracks' `enabled` flag.
- **Incoming audio** — toggled via `video.muted` on the inner card's `<video>` element.

This means the browser's mic permission prompt fires once on stream start (not on every Answer click), and Answer/Hangup feel instant.

### Caveats

- The `getUserMedia` patch is global to the page. If another card in the same page also requests audio, the most recent stream wins.
- iOS Safari ignores `navigator.vibrate()`, so iPhone users get the visual feedback only.
- If you reload the dashboard mid-call, state resets to muted.

## License

MIT — see `LICENSE`.
