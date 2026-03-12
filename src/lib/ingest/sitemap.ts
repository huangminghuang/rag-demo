import * as cheerio from "cheerio";

export async function getSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const response = await fetch(sitemapUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap ${sitemapUrl}: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  
  const urls: string[] = [];
  
  // Check if it's a sitemap index or a sitemap
  if ($("sitemapindex").length > 0) {
    const sitemapLocs = $("sitemap loc").map((_, el) => $(el).text()).get();
    for (const loc of sitemapLocs) {
      const subUrls = await getSitemapUrls(loc);
      urls.push(...subUrls);
    }
  } else {
    const locs = $("url loc").map((_, el) => $(el).text()).get();
    urls.push(...locs);
  }
  
  return urls;
}
