/**
 * Run the browser benchmark page in headless Chrome and print timings.
 *
 * Usage:
 *   pnpm run dev
 *   pnpm run benchmark:browser
 *
 * Optional base URL:
 *   node scripts/browser-benchmark.mjs http://localhost:3000
 */
import puppeteer from "puppeteer";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const timeoutMs = 30 * 60 * 1000;
const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome-stable";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);

  const consoleLogs = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[browser-benchmark]") || text.includes("[solver]")) {
      consoleLogs.push(text);
      console.log(`[page] ${text}`);
    }
  });

  const started = Date.now();
  console.log(`[runner] loading ${baseUrl}/benchmark`);
  await page.goto(`${baseUrl}/benchmark`, { waitUntil: "networkidle0" });

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="benchmark-result"]');
      return el?.getAttribute("data-status") === "complete";
    },
    { timeout: timeoutMs },
  );

  const resultText = await page.$eval(
    '[data-testid="benchmark-result"]',
    (el) => el.textContent ?? "",
  );
  const result = JSON.parse(resultText);
  const elapsed = Date.now() - started;

  console.log("\n[runner] benchmark finished");
  console.log(JSON.stringify({ runnerElapsedMs: elapsed, ...result }, null, 2));
} finally {
  await browser.close();
}
