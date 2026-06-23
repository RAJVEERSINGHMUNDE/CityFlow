const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    try {
        await page.goto('https://cityflow.pages.dev', { waitUntil: 'networkidle0' });
        
        // Click the first event
        await page.waitForSelector('aside button, aside div.cursor-pointer');
        const elements = await page.$$('aside div.cursor-pointer');
        if (elements.length > 0) {
            await elements[0].click();
            await page.waitForTimeout(3000); // wait for load
        }
        
        await page.screenshot({ path: 'screenshot_after_click.png' });
        console.log('Saved screenshot_after_click.png');
    } catch (e) {
        console.log('Error:', e);
    }
    
    await browser.close();
})();
