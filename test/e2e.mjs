/**
 * End-to-end check for the baby monitor.
 *
 * Runs against the real production bundle served by `vite preview` (so the GitHub Pages base
 * path is exercised too), with a local PeerJS broker and Chromium's fake media devices.
 * Assertions are on observable behaviour — RTP bytes actually arriving, alarms actually
 * sounding — rather than on internal state, wherever that is possible.
 *
 *   npm run build && npm run test:e2e
 */
import { chromium } from 'playwright';
import { preview } from 'vite';
import { PeerServer } from 'peer';

const BROKER = '127.0.0.1:9000/bm';
const PASS = 'quiet-otter-4821';

// Chromium bundled with the image; CI installs its own via `playwright install`.
const CHROME = process.env.E2E_CHROME_PATH;

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function waitFor(fn, { timeout = 30000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label} (last saw: ${JSON.stringify(last)})`);
}

const sel = (id) => `[data-testid="${id}"]`;
const text = (page, id) => page.$eval(sel(id), (el) => el.textContent.trim()).catch(() => null);
const value = (page, id) => page.$eval(sel(id), (el) => el.value).catch(() => null);
const present = (page, id) => page.$(sel(id)).then((el) => el !== null);

/** Bytes received on the listener's audio stream: proof that media is genuinely flowing. */
const inboundAudioBytes = (page) =>
  page.evaluate(async () => {
    const pc = window.__babyMonitor.receiver.activePeerConnection();
    if (!pc) return -1;
    let bytes = 0;
    (await pc.getStats()).forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') bytes = s.bytesReceived || 0;
    });
    return bytes;
  });

const alarmSounding = (page) => page.evaluate(() => window.__babyMonitor.alarm.sounding);

async function startMonitor(page, { mode = 'passphrase' } = {}) {
  await page.click(sel('be-monitor'));
  if (mode === 'link') await page.click(sel('monitor-mode-link'));
  await page.fill(sel('monitor-pass'), PASS);
  await page.click(sel('monitor-start'));
}

async function main() {
  const server = await preview({ configFile: 'vite.config.ts' });
  const base = server.resolvedUrls.local[0];
  const peerServer = PeerServer({ host: '127.0.0.1', port: 9000, path: '/bm' });

  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });

  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const pageErrors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => pageErrors.push(e.message)));

  const withBroker = `${base}?e2e&broker=${BROKER}`;

  /* ───────────── Mode A: passphrase pairing ───────────── */
  console.log('\nMode A — passphrase pairing through the broker');
  const mon = await ctx.newPage();
  await mon.goto(withBroker);
  check('built bundle boots at the Pages base path', await present(mon, 'be-monitor'), base);

  await startMonitor(mon);
  await waitFor(() => present(mon, 'monitor-status'), { label: 'monitor active' });
  check('monitor reaches its active screen', true, await text(mon, 'monitor-status'));

  const rec = await ctx.newPage();
  await rec.goto(withBroker);
  await rec.click(sel('be-receiver'));
  await rec.fill(sel('receiver-pass'), PASS);
  await rec.click(sel('receiver-start'));

  await waitFor(async () => (await text(rec, 'receiver-status')) === 'Listening', {
    label: 'listener connected',
  });
  check('listener connects and reports Listening', true);
  check(
    'monitor counts the listener',
    (await text(mon, 'monitor-listeners')) === '1 phone listening',
    await text(mon, 'monitor-listeners'),
  );

  const before = await inboundAudioBytes(rec);
  await sleep(3000);
  const after = await inboundAudioBytes(rec);
  check('audio bytes actually flowing to the listener', after > before && after > 0, `${before} → ${after} bytes`);

  // The watchdog declares the link dead after 10s without a heartbeat, so staying "Listening"
  // past that window is proof the heartbeat is arriving.
  await sleep(12_000);
  check(
    'heartbeat keeps the link alive past the watchdog timeout',
    (await text(rec, 'receiver-status')) === 'Listening',
    await text(rec, 'receiver-status'),
  );

  /* ───────────── knowing the broker id is not enough ───────────── */
  console.log('\nAuth — someone who scraped the broker id but lacks the passphrase');
  const denial = await mon.evaluate(async (passphrase) => {
    const { Peer, peerIdFor } = window.__babyMonitorInternals;
    const monitorId = await peerIdFor(passphrase);
    const peer = new Peer({ debug: 0, host: '127.0.0.1', port: 9000, path: '/bm', secure: false });
    return new Promise((resolve) => {
      const done = (v) => {
        try { peer.destroy(); } catch {}
        resolve(v);
      };
      setTimeout(() => done('timeout'), 20_000);
      peer.on('open', () => {
        const conn = peer.connect(monitorId, { reliable: true });
        conn.on('data', (msg) => {
          if (msg.t === 'challenge') conn.send({ t: 'auth', proof: 'f'.repeat(64) });
          if (msg.t === 'denied') done('denied');
          if (msg.t === 'ok') done('accepted');
        });
      });
      peer.on('error', (e) => done('error:' + e.type));
    });
  }, PASS);
  check('monitor denies a caller that cannot prove the passphrase', denial === 'denied', denial);
  check('monitor keeps serving its real listener throughout', (await text(rec, 'receiver-status')) === 'Listening');

  /* ───────────── resilience: monitor stops and restarts ───────────── */
  console.log('\nResilience — monitor stops and is restarted');
  await mon.click(sel('monitor-stop'));
  await waitFor(async () => (await text(rec, 'receiver-status')) !== 'Listening', {
    label: 'listener notices the drop',
  });
  check('listener detects the dropped link', true, await text(rec, 'receiver-status'));
  check('listener raises the audible alarm on loss', await alarmSounding(rec));

  // Restart the way a parent would. The broker still holds the old registration for a few
  // seconds, so this also exercises the id-reclaim path.
  await startMonitor(mon);
  await waitFor(() => present(mon, 'monitor-status'), { timeout: 60_000, label: 'monitor re-registers' });
  check('monitor reclaims its passphrase after a restart', true);

  await waitFor(async () => (await text(rec, 'receiver-status')) === 'Listening', {
    timeout: 90_000,
    label: 'listener reconnects',
  });
  check('listener reconnects automatically once the monitor returns', true);
  check('alarm stops after recovery', !(await alarmSounding(rec)));

  const resumedBefore = await inboundAudioBytes(rec);
  await sleep(3000);
  const resumedAfter = await inboundAudioBytes(rec);
  check(
    'audio resumes after the reconnect',
    resumedAfter > resumedBefore && resumedAfter > 0,
    `${resumedBefore} → ${resumedAfter} bytes`,
  );

  await rec.evaluate(() => window.__babyMonitor.receiver.stop());
  await mon.evaluate(() => window.__babyMonitor.monitor.stop());
  await mon.close();
  await rec.close();

  /* ───────────── Mode B: encrypted invite links ───────────── */
  console.log('\nMode B — shareable encrypted links, no broker involved');
  const mon2 = await ctx.newPage();
  await mon2.goto(base);
  await startMonitor(mon2, { mode: 'link' });

  const invite = await waitFor(
    async () => {
      const v = await value(mon2, 'monitor-invite-link');
      return v?.startsWith('http') ? v : false;
    },
    { label: 'invite link' },
  );
  check('monitor mints an invite link', true, `${invite.length} chars`);
  check('invite payload rides in the fragment, never reaching the server', invite.includes('#i='));

  const rec2 = await ctx.newPage();
  await rec2.goto(invite);
  check('invite link opens straight onto the listener screen', await present(rec2, 'receiver-start'));

  await rec2.fill(sel('receiver-pass'), 'not-the-passphrase');
  await rec2.click(sel('receiver-start'));
  const rejected = await waitFor(() => text(rec2, 'receiver-setup-error'), {
    timeout: 15_000,
    label: 'wrong-passphrase error',
  });
  check('wrong passphrase cannot open the invite', /wrong passphrase/i.test(rejected), rejected);

  await rec2.fill(sel('receiver-pass'), PASS);
  await rec2.click(sel('receiver-start'));
  const reply = await waitFor(
    async () => {
      const v = await value(rec2, 'receiver-reply-link');
      return v?.startsWith('http') ? v : false;
    },
    { label: 'reply link' },
  );
  check('listener mints a reply link', true, `${reply.length} chars`);

  // Regression guard: as the answerer this side sees ICE go "connected" long before the monitor
  // has the reply, so it must not claim to be listening until the monitor confirms.
  check(
    'listener does not claim to be connected before the monitor has the reply',
    !(await present(rec2, 'receiver-status')),
    (await text(rec2, 'receiver-status')) ?? 'still on the reply screen',
  );

  // The monitor phone taps the reply link: a new tab hands the answer to the waiting one.
  const ret = await ctx.newPage();
  await ret.goto(reply);
  await waitFor(async () => (await text(ret, 'return-title')) === 'Connected', {
    label: 'return-tab handoff acknowledged',
  });
  check('reply tab hands the answer to the monitoring tab', true);

  await waitFor(() => present(mon2, 'monitor-status'), { label: 'link-mode monitor active' });
  check('monitor goes live in link mode', true, await text(mon2, 'monitor-listeners'));

  await waitFor(async () => (await text(rec2, 'receiver-status')) === 'Listening', {
    label: 'link-mode listener',
  });
  const linkBefore = await inboundAudioBytes(rec2);
  await sleep(3000);
  const linkAfter = await inboundAudioBytes(rec2);
  check(
    'audio flows over the link-mode connection',
    linkAfter > linkBefore && linkAfter > 0,
    `${linkBefore} → ${linkAfter} bytes`,
  );

  check('no uncaught page errors anywhere', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  await server.close();
  peerServer.close?.();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\nHARNESS ERROR:', err);
  process.exit(2);
});
