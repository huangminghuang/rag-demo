import * as cheerio from "cheerio";
import crypto from "crypto";
export { parseHTMLToStructuredDocument } from "./structureParser";

export interface ExtractedPage {
  url: string;
  title: string;
  content: string;
  headings: { level: number; text: string; anchor: string }[];
  product: string;
  lang: string;
  hash: string;
}

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function parseHTML(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);

  // Remove boilerplate (headers, footers, nav, scripts, styles)
  $("header, footer, nav, script, style, .nav-container, .footer-container").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim();
  const content = $("article, main, .content, #main-content").first().text().trim() || $("body").text().trim();
  
  const headings: { level: number; text: string; anchor: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName.substring(1));
    const text = $(el).text().trim();
    const anchor = $(el).attr("id") || "";
    if (text) {
      headings.push({ level, text, anchor });
    }
  });

  const hash = crypto.createHash("md5").update(content).digest("hex");

  // Basic product/lang extraction from URL
  // Example: https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started
  const urlParts = new URL(url).pathname.split("/").filter(Boolean);
  const lang = urlParts[1] || "en-us";
  const product = urlParts[2] || "general";

  return {
    url,
    title,
    content,
    headings,
    product,
    lang,
    hash,
  };
}
