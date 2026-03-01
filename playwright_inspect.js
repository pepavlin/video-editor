const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() !== 'info') console.log('PAGE LOG:', msg.type(), msg.text().substring(0, 200));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click on project '1'
  try {
    const projectBtn = await page.locator('button', { hasText: /^1$/ }).first();
    console.log('Clicking project 1...');
    await projectBtn.click();
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log('Could not click project 1:', e.message);
  }

  await page.screenshot({ path: '/tmp/preview_project_open.png', fullPage: true });
  console.log('Screenshot saved: /tmp/preview_project_open.png');

  // Canvas info
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map(c => ({
      id: c.id,
      className: c.className,
      width: c.width,
      height: c.height,
      cssWidth: c.style.width,
      cssHeight: c.style.height,
      boundingRect: c.getBoundingClientRect(),
    }));
  });
  console.log('Canvases:', JSON.stringify(canvasInfo, null, 2));

  // Zoom wrapper
  const zoomWrapperInfo = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="preview-zoom-wrapper"]');
    if (!wrapper) return { error: 'no zoom wrapper' };
    return {
      boundingRect: wrapper.getBoundingClientRect(),
      style: wrapper.getAttribute('style'),
    };
  });
  console.log('Zoom wrapper:', JSON.stringify(zoomWrapperInfo, null, 2));

  // Container
  const containerInfo = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="preview-zoom-wrapper"]');
    if (!wrapper) return { error: 'no wrapper' };
    const container = wrapper.parentElement;
    if (!container) return { error: 'no container' };
    return {
      boundingRect: container.getBoundingClientRect(),
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight,
    };
  });
  console.log('Container:', JSON.stringify(containerInfo, null, 2));

  // Resize handles
  const resizeInfo = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const resizeHandles = allEls
      .filter(el => {
        const style = window.getComputedStyle(el);
        const cursor = style.cursor;
        return cursor === 'col-resize' || cursor === 'row-resize' || cursor === 'ew-resize' || cursor === 'ns-resize';
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className.toString().substring(0, 100),
        cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(),
      }));

    const handleElements = allEls
      .filter(el => {
        const cls = (el.className || '').toString().toLowerCase();
        const id = (el.id || '').toLowerCase();
        return cls.includes('handle') || cls.includes('resize') || id.includes('handle') || id.includes('resize');
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className.toString().substring(0, 100),
        rect: el.getBoundingClientRect(),
      }));

    return { resizeHandles, handleElements };
  });
  console.log('Resize handles:', JSON.stringify(resizeInfo, null, 2));

  // Videos
  const videos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('video')).map(v => ({
      id: v.id, src: v.src, rect: v.getBoundingClientRect()
    }));
  });
  console.log('Videos:', JSON.stringify(videos, null, 2));

  // data-testid elements
  const testIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      testid: el.dataset.testid,
      tag: el.tagName,
      rect: el.getBoundingClientRect(),
    }));
  });
  console.log('data-testid elements:', JSON.stringify(testIds, null, 2));

  await browser.close();
})();
