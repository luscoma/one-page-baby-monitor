# One-Page Baby Monitor

Turn two phones into a Wi-Fi baby monitor. One phone sits with the baby and streams its
microphone; the other phone listens. No app, no account, no sign-up — just a web page.

**Live page:** https://luscoma.github.io/one-page-baby-monitor/

Audio travels **directly between the two phones** over your Wi-Fi as an encrypted WebRTC
stream. Nothing is recorded, and no audio ever passes through a server.

## How to use it

Open the page on both phones.

**On the baby's phone** — tap *Start Monitoring*, tap *Generate* for a passphrase, tap
*Start Monitoring* again. Leave the page open and the phone plugged in.

**On your phone** — tap *Listen*, type the same passphrase, tap *Connect*.

That's it. The listening phone shows a live status, sounds an alarm if the link drops, and
reconnects on its own.

## Two ways to pair

**Passphrase** (default) — both phones turn the passphrase into the same connection ID and
find each other through a public matchmaking service. Easiest, and the only mode that can
reconnect by itself. Needs internet at the moment of connecting.

**Share a link** — the monitor phone generates an invite link you send over WhatsApp or
iMessage; the listening phone sends a reply link back. No third-party service is involved at
all. Two steps instead of one, and no automatic reconnect, so use this if you would rather not
touch a matchmaking service.

Either way you still need the passphrase — an invite link on its own is useless without it.

## What protects the audio

- The stream is WebRTC, so it is **encrypted end to end (DTLS-SRTP)** between the two phones.
  This is not optional and cannot be turned off.
- In passphrase mode the matchmaking service only ever sees a **slow hash** of your passphrase
  (PBKDF2, 100k iterations), never the passphrase, and never any audio.
- Knowing that hash is not enough to listen in. Before handing over the microphone, the monitor
  phone **challenges the caller to prove it knows the passphrase**, so whoever runs the
  matchmaking service cannot quietly dial into your nursery. There is an end-to-end test for
  exactly this.
- Invite links are **encrypted with the passphrase** (AES-GCM, PBKDF2-derived key) and the
  payload lives in the URL fragment, which browsers never send to the web server.

The passphrase is the whole of your security, so use the *Generate* button rather than
something guessable. Anyone with the passphrase can listen.

## Known limitations

**The monitor phone's screen has to stay on, with this page in front.** iPhones and Android
phones both cut off microphone access when the browser is backgrounded or the screen locks — no
web page can work around this. The page keeps the screen awake automatically (iOS 16.4+,
Android Chrome). On older iOS, set Settings → Display & Brightness → Auto-Lock → Never while
you're using it. Keep the phone plugged in.

**Volume is the hardware buttons.** iOS ignores web pages that try to set playback volume, so
use the phone's volume rocker.

**iOS may route the audio to the earpiece** rather than the speaker on some versions, which
sounds very quiet unless you hold the phone to your ear. Headphones or a Bluetooth speaker
sidestep it.

**Both phones should be on the same Wi-Fi.** That is what keeps the audio local and the latency
low.

**Link mode does not reconnect.** If the connection drops, generate a fresh invite. Use
passphrase mode if you want it to heal itself overnight.

## Development

TypeScript and React, bundled by Vite. No global tooling needed beyond Node 22.

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run typecheck  # tsc --noEmit
npm test           # unit tests (vitest)
npm run build      # typecheck + bundle into dist/
npm run test:e2e   # drives two real browser pages against the built bundle
```

`npm run test:e2e` needs a build first. It starts a local PeerJS broker and a `vite preview`
server, then drives Chromium with fake media devices through both pairing modes — asserting on
RTP bytes actually arriving rather than on UI text alone. Browsers come from
`npx playwright install chromium`, or point `E2E_CHROME_PATH` at an existing binary.

Microphone access requires a secure context, so use `localhost` or HTTPS.

### Architecture

The two session controllers (`src/session/MonitorSession.ts`, `ReceiverSession.ts`) own all
WebRTC and PeerJS state and are deliberately **not** React components. They expose
`subscribe`/`getSnapshot` and are rendered through `useSyncExternalStore`. WebRTC is long-lived
and order-sensitive; keeping it out of the render cycle is what makes the reconnect logic
tractable and stops StrictMode's double-invoked effects from tearing down live connections.

Two hazards that logic exists to handle, both learned the hard way:

- **Superseded attempts.** Tearing down a peer fires that peer's own close/error handlers,
  which would otherwise schedule a redial that kills the connection replacing it. Every attempt
  carries a generation number and stale handlers bail out.
- **Premature "connected".** `ontrack` fires when the remote description is set, and the
  *answering* side's `iceConnectionState` reaches `connected` while the offering side is still
  waiting for the answer. Neither means audio is flowing. The monitor's heartbeat and control
  channel are the honest signals.

| Path | What lives there |
| --- | --- |
| `src/lib/` | Crypto, WebRTC helpers, wake lock, audio and alarm, invite links, cross-tab handoff |
| `src/session/` | The two session controllers and their tiny store base |
| `src/ui/` | React screens, one CSS Module each |
| `src/types.ts` | Control-channel message union and the snapshot shapes |
| `test/e2e.mjs` | Browser-driven end-to-end suite |

### Deploying your own copy

Fork the repo, then set **Settings → Pages → Source: GitHub Actions**. The workflow in
`.github/workflows/deploy.yml` typechecks, tests, builds and publishes on every push to `main`.

If you rename the repository, update `base` in `vite.config.ts` to match — Pages serves from a
subpath and the assets are requested relative to it.

By default, passphrase mode uses the free PeerJS cloud broker for matchmaking. If you run your
own [peerjs-server](https://github.com/peers/peerjs-server), point the page at it with
`?broker=your.host:9000/path` and no third party is involved in either mode.

## Ideas not built yet

Video as well as audio, a white-noise generator on the baby's phone, a sound-level meter,
talk-back so you can speak into the room, and remote lullabies.

QR-code pairing would be a nice offline alternative to invite links. NFC tap-to-pair is not
possible: Web NFC exists only in Chrome on Android and only talks to passive tags, not between
two phones.
