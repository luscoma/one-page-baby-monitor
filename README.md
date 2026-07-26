# One-Page Baby Monitor

Turn two phones into a Wi-Fi baby monitor. One phone sits with the baby and streams its
microphone; the other phone listens. It is a single static page — open it, tap a button,
done. No app, no account, no sign-up.

**Live page:** https://luscoma.github.io/one-page-baby-monitor/

Audio travels **directly between the two phones** over your Wi-Fi as an encrypted WebRTC
stream. Nothing is recorded, and no audio ever passes through a server.

## How to use it

Open the page on both phones.

**On the baby's phone** — tap *Start Monitoring*, tap *Generate* for a passphrase, tap
*Start Monitoring* again. Leave the page open and the phone plugged in.

**On your phone** — tap *Listen*, type the same passphrase, tap *Connect*.

That's it. The listening phone shows a live status and sounds an alarm if the link drops,
then reconnects on its own.

## Two ways to pair

**Passphrase** (default) — both phones turn the passphrase into the same connection ID and
find each other through a public matchmaking service. Easiest, and the only mode that can
reconnect by itself. Needs internet at the moment of connecting.

**Share a link** — the monitor phone generates an invite link you send over WhatsApp or
iMessage; the listening phone sends a reply link back. No third-party service is involved
at all. Two steps instead of one, and no automatic reconnect, so use this if you would
rather not touch a matchmaking service.

Either way you still need the passphrase — an invite link on its own is useless without it.

## What protects the audio

- The stream itself is WebRTC, so it is **encrypted end to end (DTLS-SRTP)** between the
  two phones. This is not optional and cannot be turned off.
- In passphrase mode the matchmaking service only ever sees a **slow hash** of your
  passphrase, never the passphrase, and never any audio.
- Knowing that hash is not enough to listen in. Before handing over the microphone, the
  monitor phone challenges the listener to **prove it knows the passphrase**, so whoever
  runs the matchmaking service cannot quietly dial into your nursery.
- Invite links are **encrypted with the passphrase** (AES-GCM, PBKDF2-derived key) and the
  payload lives in the URL fragment, which browsers never send to the web server.

The passphrase is the whole of your security, so use the *Generate* button rather than
something guessable. Anyone with the passphrase can listen.

## Known limitations

**The monitor phone's screen has to stay on, with this page in front.** iPhones and Android
phones both cut off microphone access when the browser is backgrounded or the screen locks —
no web page can work around this. The page keeps the screen awake automatically
(iOS 16.4+, Android Chrome). On older iOS, set Settings → Display & Brightness → Auto-Lock →
Never while you're using it. Keep the phone plugged in.

**Volume is the hardware buttons.** iOS ignores web pages that try to set playback volume,
so use the phone's volume rocker.

**iOS may route the audio to the earpiece** rather than the speaker on some versions, which
sounds very quiet unless you hold the phone to your ear. Headphones or a Bluetooth speaker
sidestep it.

**Both phones should be on the same Wi-Fi.** That is what keeps the audio local and the
latency low.

**Link mode does not reconnect.** If the connection drops, generate a fresh invite. Use
passphrase mode if you want it to heal itself overnight.

## Running it yourself

It is plain HTML, CSS and JavaScript with no build step. Serve the folder over HTTPS (or
`localhost`) — microphone access requires a secure context:

```sh
python3 -m http.server 8000
```

To publish your own copy: fork the repo, then **Settings → Pages → Source: Deploy from a
branch → `main` / root**. GitHub serves it over HTTPS, which is all this needs.

By default, passphrase mode uses the free PeerJS cloud broker for matchmaking. If you run
your own [peerjs-server](https://github.com/peers/peerjs-server), point the page at it with
`?broker=your.host:9000/path` and no third party is involved in either mode.

## Ideas not built yet

Video as well as audio, a white-noise generator on the baby's phone, a sound-level meter,
talk-back so you can speak into the room, and remote lullabies.

QR-code pairing would be a nice offline alternative to invite links. NFC tap-to-pair is not
possible: Web NFC exists only in Chrome on Android and only talks to passive tags, not
between two phones.

## Layout

| File | What it does |
| --- | --- |
| `index.html` | All screens for both roles |
| `app.js` | Pairing, crypto, WebRTC, wake lock, reconnect |
| `style.css` | Mobile-first dark theme |
| `vendor/peerjs.min.js` | PeerJS client, vendored so no CDN is needed |
