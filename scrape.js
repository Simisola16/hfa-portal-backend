import { chromium } from 'playwright';
import fs from 'fs/promises';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeAllPages(page, label) {
  // Collect nav links
  const navLinks = await page.$$eval('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a, [role="navigation"] a', 
    els => els.map(el => ({ text: el.innerText?.trim(), href: el.href })).filter(l => l.text && l.href)
  );
  
  let result = `\n===== ${label} =====\nNAV LINKS:\n`;
  navLinks.forEach(l => result += `  - ${l.text}: ${l.href}\n`);
  
  // Get current page body text
  const bodyText = await page.innerText('body');
  result += `\nPAGE CONTENT:\n${bodyText}\n`;
  
  // Click through each nav link
  for (const link of navLinks.slice(0, 20)) {
    try {
      await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(2000);
      const pageText = await page.innerText('body');
      result += `\n--- PAGE: ${link.text} (${link.href}) ---\n${pageText}\n`;
    } catch (e) {
      result += `\n--- PAGE: ${link.text} - FAILED: ${e.message}\n`;
    }
  }
  
  return result;
}

async function scrapeHCAAdmin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to HCA Admin Portal...");
  await page.goto('https://hca-admin-portal.vercel.app', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  // Take screenshot to see login form
  const loginHtml = await page.innerHTML('body');
  await fs.writeFile('hca_admin_login.html', loginHtml);
  
  // Try to fill login form
  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passwordInput = await page.$('input[type="password"]');
  
  if (emailInput && passwordInput) {
    await emailInput.fill('test@gmail.com');
    await passwordInput.fill('abc123');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await sleep(4000);
  }
  
  const afterLoginUrl = page.url();
  console.log("After login URL:", afterLoginUrl);
  
  const afterLoginHtml = await page.innerHTML('body');
  await fs.writeFile('hca_admin_after_login.html', afterLoginHtml);
  
  const text = await scrapeAllPages(page, 'HCA Admin');
  await fs.writeFile('hca_admin_full.txt', text);
  console.log("HCA Admin scraping done.");
  
  await browser.close();
}

async function scrapeHCAClient() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to HCA Client Portal...");
  await page.goto('https://halal-certification-authority.vercel.app', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passwordInput = await page.$('input[type="password"]');
  
  if (emailInput && passwordInput) {
    await emailInput.fill('oluwayomi.obadina@eatngo-africa.com');
    await passwordInput.fill('abc123');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await sleep(4000);
  }
  
  const text = await scrapeAllPages(page, 'HCA Client');
  await fs.writeFile('hca_client_full.txt', text);
  console.log("HCA Client scraping done.");
  
  await browser.close();
}

async function scrapeHFAAdmin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to HFA Admin Portal...");
  await page.goto('https://app.hfa-portal.com', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  const loginHtml = await page.innerHTML('body');
  await fs.writeFile('hfa_admin_login.html', loginHtml);
  console.log("HFA login page URL:", page.url());
  
  // Try username/email input
  const allInputs = await page.$$('input');
  console.log("HFA Inputs found:", allInputs.length);
  
  for (const input of allInputs) {
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    const placeholder = await input.getAttribute('placeholder');
    console.log(`  Input: type=${type} name=${name} placeholder=${placeholder}`);
  }
  
  // Fill in credentials
  const usernameInput = await page.$('input[name="username"], input[name="email"], input[type="text"]:not([type="password"])');
  const passwordInput = await page.$('input[type="password"]');
  
  if (usernameInput) await usernameInput.fill('coders');
  if (passwordInput) await passwordInput.fill('abc123');
  
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
  if (submitBtn) await submitBtn.click();
  await sleep(5000);
  
  const afterLoginUrl = page.url();
  console.log("HFA After login URL:", afterLoginUrl);
  
  const afterLoginHtml = await page.innerHTML('body');
  await fs.writeFile('hfa_admin_after_login.html', afterLoginHtml);
  
  const text = await scrapeAllPages(page, 'HFA Admin');
  await fs.writeFile('hfa_admin_full.txt', text);
  console.log("HFA Admin scraping done.");
  
  await browser.close();
}

async function scrapeHFAClient() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to HFA Client Portal...");
  await page.goto('https://hfa-portals.com', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  const loginHtml = await page.innerHTML('body');
  await fs.writeFile('hfa_client_login.html', loginHtml);
  
  const allInputs = await page.$$('input');
  for (const input of allInputs) {
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    console.log(`  HFA Client Input: type=${type} name=${name}`);
  }
  
  const usernameInput = await page.$('input[name="username"], input[name="email"], input[type="text"]:not([type="password"])');
  const passwordInput = await page.$('input[type="password"]');
  
  if (usernameInput) await usernameInput.fill('villagecoders7@gmail.com');
  if (passwordInput) await passwordInput.fill('test123');
  
  const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (submitBtn) await submitBtn.click();
  await sleep(5000);
  
  const afterLoginUrl = page.url();
  console.log("HFA Client After login URL:", afterLoginUrl);
  
  const afterLoginHtml = await page.innerHTML('body');
  await fs.writeFile('hfa_client_after_login.html', afterLoginHtml);
  
  const text = await scrapeAllPages(page, 'HFA Client');
  await fs.writeFile('hfa_client_full.txt', text);
  console.log("HFA Client scraping done.");
  
  await browser.close();
}

async function run() {
  try { await scrapeHCAAdmin(); } catch(e) { console.error("HCA Admin failed:", e); }
  try { await scrapeHCAClient(); } catch(e) { console.error("HCA Client failed:", e); }
  try { await scrapeHFAAdmin(); } catch(e) { console.error("HFA Admin failed:", e); }
  try { await scrapeHFAClient(); } catch(e) { console.error("HFA Client failed:", e); }
  console.log("ALL DONE.");
}

run();
