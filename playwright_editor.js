const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Take Screenshot 1: Project selector (initial state)
  await page.screenshot({ path: '/tmp/screenshot_1_initial.png', fullPage: true });
  console.log('Screenshot 1 saved: /tmp/screenshot_1_initial.png (initial project selector)');

  // Click "Create Project" to try to open the editor
  try {
    const createBtn = page.locator('button', { hasText: 'Create Project' }).first();
    await createBtn.click();
    console.log('Clicked Create Project');
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log('Could not click Create Project:', e.message);
  }

  // Take Screenshot 2: After creating/selecting project
  await page.screenshot({ path: '/tmp/screenshot_2_after_create.png', fullPage: true });
  console.log('Screenshot 2 saved: /tmp/screenshot_2_after_create.png');

  // Check what the page looks like now
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Page text after create:', pageText);

  // Check for any editor-related elements
  const editorInfo = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const interestingEls = allEls
      .filter(el => {
        const cls = (el.className || '').toString().toLowerCase();
        const id = (el.id || '').toLowerCase();
        return cls.includes('preview') || cls.includes('canvas') || cls.includes('timeline') ||
               cls.includes('editor') || id.includes('preview') || id.includes('canvas') ||
               id.includes('timeline') || id.includes('editor');
      })
      .slice(0, 15)
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className.toString().substring(0, 80),
        rect: el.getBoundingClientRect(),
      }));
    return interestingEls;
  });
  console.log('Editor elements:', JSON.stringify(editorInfo, null, 2));

  // Check for canvas
  const canvasInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map(c => ({
      id: c.id,
      width: c.width,
      height: c.height,
      style: c.getAttribute('style'),
      rect: c.getBoundingClientRect(),
    }));
  });
  console.log('Canvases:', JSON.stringify(canvasInfo, null, 2));

  // Check for zoom wrapper
  const zoomWrapper = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="preview-zoom-wrapper"]');
    if (!wrapper) return { error: 'no zoom wrapper' };
    return {
      boundingRect: wrapper.getBoundingClientRect(),
      style: wrapper.getAttribute('style'),
      parentRect: wrapper.parentElement ? wrapper.parentElement.getBoundingClientRect() : null,
      parentClientWidth: wrapper.parentElement ? wrapper.parentElement.clientWidth : null,
      parentClientHeight: wrapper.parentElement ? wrapper.parentElement.clientHeight : null,
    };
  });
  console.log('Zoom wrapper:', JSON.stringify(zoomWrapper, null, 2));

  // Check for resize handles
  const resizeHandles = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    return allEls
      .filter(el => {
        const style = window.getComputedStyle(el);
        return ['col-resize','row-resize','ew-resize','ns-resize'].includes(style.cursor);
      })
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className.toString().substring(0, 80),
        cursor: window.getComputedStyle(el).cursor,
        rect: el.getBoundingClientRect(),
      }));
  });
  console.log('Resize handles:', JSON.stringify(resizeHandles, null, 2));

  // Check for video elements
  const videos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('video')).map(v => ({
      id: v.id,
      src: v.src,
      rect: v.getBoundingClientRect(),
    }));
  });
  console.log('Videos:', JSON.stringify(videos, null, 2));

  // Take Screenshot 3: Final state  
  await page.screenshot({ path: '/tmp/screenshot_3_final.png', fullPage: true });
  console.log('Screenshot 3 saved: /tmp/screenshot_3_final.png');

  await browser.close();
})();
