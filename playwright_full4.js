const { chromium } = require('playwright');

const mockProject = {
  id: 'test-project-1',
  name: 'Test Project',
  tracks: [{ id: 'track-1', clips: [] }],
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  duration: 10,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Intercept ALL requests to see what's failing
  page.on('request', req => {
    const url = req.url();
    if (url.includes('localhost:3000') && url.includes('/api/')) {
      console.log('API REQ:', req.method(), url.replace('http://localhost:3000', ''));
    }
  });
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('localhost:3000') && url.includes('/api/') && resp.status() >= 400) {
      console.log('API ERR:', resp.status(), url.replace('http://localhost:3000', ''));
    }
  });

  await page.route('**/api/projects', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [mockProject] }) });
    } else if (method === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: mockProject }) });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/projects/**', async (route) => {
    const method = route.request().method();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: mockProject }) });
  });

  await page.route('**/api/assets', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [] }) });
  });

  await page.route('**/api/assets/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/waveform')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ waveform: null }) });
    } else if (url.includes('/beats')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ beats: null }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
  });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React') && !text.includes('font-weight')) {
      console.log('PAGE:', msg.type(), text.substring(0, 250));
    }
  });
  page.on('pageerror', err => {
    console.log('PAGE EXCEPTION:', err.message.substring(0, 300));
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click "Test Project"
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const proj = btns.find(b => b.textContent?.includes('Test Project'));
    if (proj) { proj.click(); return 'Test Project'; }
    return null;
  });
  console.log('\nClicked project:', clicked);
  await page.waitForTimeout(5000);

  // Screenshot 1: after project opens
  await page.screenshot({ path: '/tmp/screenshot_1_initial.png', fullPage: true });
  console.log('Screenshot 1 saved: /tmp/screenshot_1_initial.png');

  // Check for any error overlay or loading state
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 400));
  console.log('Page text:', pageText);

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
      };
    })();

    const resizeHandles = Array.from(document.querySelectorAll('*'))
      .filter(el => ['col-resize','row-resize','ew-resize','ns-resize'].includes(window.getComputedStyle(el).cursor))
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName, cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(), className: el.className?.toString().substring(0, 60),
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
  console.log('Resize handles:', JSON.stringify(domReport.resizeHandles, null, 2));
  console.log('data-testid elements:', JSON.stringify(domReport.testIds, null, 2));
  console.log('Videos:', JSON.stringify(domReport.videos, null, 2));

  // Screenshot 2
  await page.screenshot({ path: '/tmp/screenshot_2_editor.png', fullPage: true });
  console.log('\nScreenshot 2 saved: /tmp/screenshot_2_editor.png');

  // Try interacting with resize handle if found
  if (domReport.resizeHandles.length > 0) {
    const handle = domReport.resizeHandles[0];
    const cx = handle.rect.left + handle.rect.width / 2;
    const cy = handle.rect.top + handle.rect.height / 2;
    console.log('Dragging resize handle from', cx, cy, 'by 100px');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
  }

  // Screenshot 3: after resize
  await page.screenshot({ path: '/tmp/screenshot_3_final.png', fullPage: true });
  console.log('Screenshot 3 saved: /tmp/screenshot_3_final.png');

  await browser.close();
})();
