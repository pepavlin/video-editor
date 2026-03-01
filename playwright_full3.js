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

  // Set up route mocking BEFORE navigation
  await page.route('**/api/projects', async (route) => {
    const method = route.request().method();
    console.log('Intercepted /api/projects', method);
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [mockProject] })
      });
    } else if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project: mockProject })
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/projects/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    console.log('Intercepted /api/projects/**', method, url);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ project: mockProject })
    });
  });

  await page.route('**/api/assets', async (route) => {
    console.log('Intercepted /api/assets');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ assets: [] })
    });
  });

  await page.route('**/api/assets/**', async (route) => {
    const url = route.request().url();
    console.log('Intercepted /api/assets/**', url);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ waveform: [], beats: [] })
    });
  });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React') && !text.includes('font-weight')) {
      console.log('PAGE:', msg.type(), text.substring(0, 200));
    }
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Screenshot 1: project selector
  await page.screenshot({ path: '/tmp/screenshot_1_initial.png', fullPage: true });
  console.log('\nScreenshot 1 saved: /tmp/screenshot_1_initial.png');

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 400));
  console.log('Page text:', bodyText);

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim().substring(0, 40))
  );
  console.log('Buttons:', buttons);

  // Click "Test Project" 
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const proj = btns.find(b => b.textContent?.includes('Test Project'));
    if (proj) { proj.click(); return 'Test Project'; }
    // Try any button that looks like a project
    const any = btns.find(b => {
      const t = b.textContent?.trim() || '';
      return t.length > 0 && !['Create Project', '◑'].includes(t);
    });
    if (any) { any.click(); return any.textContent?.trim(); }
    return null;
  });
  console.log('Clicked:', clicked);
  await page.waitForTimeout(4000);

  // Screenshot 2: editor view
  await page.screenshot({ path: '/tmp/screenshot_2_editor.png', fullPage: true });
  console.log('Screenshot 2 saved: /tmp/screenshot_2_editor.png');

  // Full DOM inspection
  const domReport = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      id: c.id,
      width: c.width,
      height: c.height,
      style: c.getAttribute('style'),
      rect: c.getBoundingClientRect(),
    }));

    const zoomWrapper = (() => {
      const w = document.querySelector('[data-testid="preview-zoom-wrapper"]');
      if (!w) return null;
      const p = w.parentElement;
      return {
        wrapperRect: w.getBoundingClientRect(),
        wrapperStyle: w.getAttribute('style'),
        containerRect: p ? p.getBoundingClientRect() : null,
        containerClientW: p ? p.clientWidth : null,
        containerClientH: p ? p.clientHeight : null,
      };
    })();

    const resizeHandles = Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const c = window.getComputedStyle(el).cursor;
        return ['col-resize','row-resize','ew-resize','ns-resize'].includes(c);
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(),
        className: el.className?.toString().substring(0, 60),
      }));

    const testIds = Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      testid: el.dataset.testid,
      tag: el.tagName,
      rect: el.getBoundingClientRect(),
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

  // Screenshot 3: final
  await page.screenshot({ path: '/tmp/screenshot_3_final.png', fullPage: true });
  console.log('\nScreenshot 3 saved: /tmp/screenshot_3_final.png');

  await browser.close();
})();
