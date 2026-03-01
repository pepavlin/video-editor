const { chromium } = require('playwright');

const mockProject = {
  id: 'test-project-1',
  name: 'Test Project',
  duration: 10,
  aspectRatio: '16:9',
  outputResolution: { w: 1920, h: 1080 },
  tracks: [
    { id: 'track-1', type: 'video', name: 'Video 1', clips: [] }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/')) console.log('REQ:', req.method(), url.replace('http://localhost:3000', ''));
  });
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/api/') && resp.status() >= 400)
      console.log('ERR:', resp.status(), url.replace('http://localhost:3000', ''));
  });

  await page.route('**/api/projects', async (route) => {
    const m = route.request().method();
    if (m === 'GET') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [mockProject] }) });
    else if (m === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: mockProject }) });
    else await route.continue();
  });

  await page.route('**/api/projects/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: mockProject }) });
  });

  await page.route('**/api/assets', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [] }) });
  });

  await page.route('**/api/assets/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/waveform')) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ waveform: null }) });
    else if (url.includes('/beats')) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ beats: null }) });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route('**/api/media', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) });
  });

  page.on('console', msg => {
    const t = msg.text();
    if (!t.includes('Download the React') && !t.includes('font-weight'))
      console.log('PAGE:', msg.type(), t.substring(0, 200));
  });
  page.on('pageerror', err => console.log('EXCEPTION:', err.message.substring(0, 200)));

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click Test Project
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Test Project'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('Clicked project:', clicked);
  await page.waitForTimeout(5000);

  // Screenshot 1: editor loaded
  await page.screenshot({ path: '/tmp/screenshot_1_initial.png', fullPage: true });
  console.log('\nScreenshot 1 saved: /tmp/screenshot_1_initial.png');

  // DOM report
  const domReport = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      id: c.id, width: c.width, height: c.height,
      style: c.getAttribute('style'), rect: c.getBoundingClientRect(),
    }));

    const zoomWrapper = (() => {
      const w = document.querySelector('[data-testid="preview-zoom-wrapper"]');
      if (!w) return null;
      const p = w.parentElement;
      return {
        wrapperRect: w.getBoundingClientRect(),
        wrapperStyle: w.getAttribute('style'),
        containerClientW: p ? p.clientWidth : null,
        containerClientH: p ? p.clientHeight : null,
        containerRect: p ? p.getBoundingClientRect() : null,
      };
    })();

    const resizeHandles = Array.from(document.querySelectorAll('*'))
      .filter(el => ['col-resize','row-resize','ew-resize','ns-resize'].includes(window.getComputedStyle(el).cursor))
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName, cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(), className: el.className?.toString().substring(0, 80),
      }));

    const testIds = Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      testid: el.dataset.testid, tag: el.tagName, rect: el.getBoundingClientRect(),
    }));

    const videos = Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.src, rect: v.getBoundingClientRect()
    }));

    return { canvases, zoomWrapper, resizeHandles, testIds, videos };
  });

  console.log('\n=== DOM REPORT ===');
  console.log('Canvases:', JSON.stringify(domReport.canvases, null, 2));
  console.log('Zoom wrapper:', JSON.stringify(domReport.zoomWrapper, null, 2));
  console.log('Resize handles (cursor-based):', JSON.stringify(domReport.resizeHandles, null, 2));
  console.log('data-testid elements:', JSON.stringify(domReport.testIds, null, 2));
  console.log('Videos:', JSON.stringify(domReport.videos, null, 2));

  // Try resize interaction if handles found
  if (domReport.resizeHandles.length > 0) {
    const h = domReport.resizeHandles[0];
    const cx = (h.rect.left + h.rect.right) / 2;
    const cy = (h.rect.top + h.rect.bottom) / 2;
    const deltaX = h.cursor === 'col-resize' ? 100 : 0;
    const deltaY = h.cursor === 'row-resize' ? 100 : 0;
    console.log(`\nDragging resize handle (${h.cursor}) from (${cx}, ${cy}) by (${deltaX}, ${deltaY})`);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + deltaX, cy + deltaY, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
  }

  // Screenshot 2
  await page.screenshot({ path: '/tmp/screenshot_2_editor.png', fullPage: true });
  console.log('\nScreenshot 2 saved: /tmp/screenshot_2_editor.png');

  // Screenshot 3
  await page.screenshot({ path: '/tmp/screenshot_3_final.png', fullPage: true });
  console.log('Screenshot 3 saved: /tmp/screenshot_3_final.png');

  await browser.close();
})();
