const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Mock the API responses so the editor renders
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'test-project-1',
          name: 'Test Project',
          tracks: [
            { id: 'track-1', clips: [] }
          ],
          resolution: { width: 1920, height: 1080 },
          fps: 30,
          duration: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }])
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/projects/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-project-1',
        name: 'Test Project',
        tracks: [
          { id: 'track-1', clips: [] }
        ],
        resolution: { width: 1920, height: 1080 },
        fps: 30,
        duration: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    });
  });

  await page.route('**/api/assets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Screenshot 1: Initial state
  await page.screenshot({ path: '/tmp/screenshot_1_initial.png', fullPage: true });
  console.log('Screenshot 1 (initial): /tmp/screenshot_1_initial.png');

  // Click on the test project
  try {
    const projectBtn = page.locator('button', { hasText: 'Test Project' }).first();
    await projectBtn.click();
    console.log('Clicked Test Project');
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log('Could not click Test Project:', e.message);
    // Try clicking any project-like button
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim())
    );
    console.log('Available buttons:', buttons);
  }

  // Screenshot 2: Editor view
  await page.screenshot({ path: '/tmp/screenshot_2_editor.png', fullPage: true });
  console.log('Screenshot 2 (editor): /tmp/screenshot_2_editor.png');

  // Canvas info
  const canvasInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map(c => ({
      id: c.id,
      width: c.width,
      height: c.height,
      cssWidth: c.style.width,
      cssHeight: c.style.height,
      boundingRect: c.getBoundingClientRect(),
    }));
  });
  console.log('Canvases:', JSON.stringify(canvasInfo, null, 2));

  // Zoom wrapper
  const zoomWrapper = await page.evaluate(() => {
    const w = document.querySelector('[data-testid="preview-zoom-wrapper"]');
    if (!w) return { error: 'no zoom wrapper' };
    const container = w.parentElement;
    return {
      wrapperRect: w.getBoundingClientRect(),
      wrapperStyle: w.getAttribute('style'),
      containerRect: container ? container.getBoundingClientRect() : null,
      containerClientWidth: container ? container.clientWidth : null,
      containerClientHeight: container ? container.clientHeight : null,
    };
  });
  console.log('Zoom wrapper:', JSON.stringify(zoomWrapper, null, 2));

  // Resize handles
  const resizeHandles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const cursor = window.getComputedStyle(el).cursor;
        return ['col-resize','row-resize','ew-resize','ns-resize'].includes(cursor);
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className?.toString().substring(0, 80),
        cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(),
      }));
  });
  console.log('Resize handles:', JSON.stringify(resizeHandles, null, 2));

  // data-testid elements
  const testIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      testid: el.dataset.testid,
      tag: el.tagName,
      rect: el.getBoundingClientRect(),
    }));
  });
  console.log('data-testid elements:', JSON.stringify(testIds, null, 2));

  // Videos
  const videos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('video')).map(v => ({
      id: v.id, src: v.src, rect: v.getBoundingClientRect()
    }));
  });
  console.log('Videos:', JSON.stringify(videos, null, 2));

  // Screenshot 3: Final state
  await page.screenshot({ path: '/tmp/screenshot_3_final.png', fullPage: true });
  console.log('Screenshot 3 (final): /tmp/screenshot_3_final.png');

  await browser.close();
})();
