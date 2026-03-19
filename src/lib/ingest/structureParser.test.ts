import { describe, expect, it } from "vitest";
import { parseHTMLToStructuredDocument } from "./structureParser";

describe("parseHTMLToStructuredDocument", () => {
  it("prefers the main content container over boilerplate", () => {
    const html = `
      <html>
        <head><title>Docs Title</title></head>
        <body>
          <nav><p>Nav content that should be ignored</p></nav>
          <main>
            <h1 id="intro">Introduction</h1>
            <p>Primary content paragraph.</p>
          </main>
          <footer><p>Footer content that should be ignored</p></footer>
        </body>
      </html>
    `;

    const parsed = parseHTMLToStructuredDocument(html, "https://example.com/docs/en-us/guide/start");

    expect(parsed.title).toBe("Docs Title");
    expect(parsed.lang).toBe("en-us");
    expect(parsed.product).toBe("guide");
    expect(parsed.elements.map((element) => element.text)).toEqual([
      "Introduction",
      "Primary content paragraph.",
    ]);
  });

  it("builds heading paths rooted at the document title", () => {
    const html = `
      <html>
        <head><title>Vite Guide</title></head>
        <body>
          <article>
            <h1 id="config">Configuring Vite</h1>
            <p>Configuration overview.</p>
            <h2 id="build-options">Build Options</h2>
            <p>Build details.</p>
          </article>
        </body>
      </html>
    `;

    const parsed = parseHTMLToStructuredDocument(html, "https://example.com/docs/en-us/guide/config");

    expect(parsed.elements).toHaveLength(4);
    expect(parsed.elements[0].headingPath).toEqual(["Vite Guide", "Configuring Vite"]);
    expect(parsed.elements[1].headingPath).toEqual(["Vite Guide", "Configuring Vite"]);
    expect(parsed.elements[2].headingPath).toEqual([
      "Vite Guide",
      "Configuring Vite",
      "Build Options",
    ]);
    expect(parsed.elements[3].headingPath).toEqual([
      "Vite Guide",
      "Configuring Vite",
      "Build Options",
    ]);
  });

  it("extracts typed table and code elements with preserved metadata", () => {
    const html = `
      <html>
        <head><title>Reference</title></head>
        <body>
          <article>
            <h1 id="api">API</h1>
            <table id="limits">
              <tr><th>Name</th><th>Value</th></tr>
              <tr><td>Rate limit</td><td>100</td></tr>
            </table>
            <pre id="example"><code class="language-ts">const value = 1;\nconsole.log(value);</code></pre>
          </article>
        </body>
      </html>
    `;

    const parsed = parseHTMLToStructuredDocument(html, "https://example.com/docs/en-us/reference/api");

    const table = parsed.elements.find((element) => element.type === "table");
    const code = parsed.elements.find((element) => element.type === "code");

    expect(table).toMatchObject({
      type: "table",
      anchor: "limits",
      headingPath: ["Reference", "API"],
      rows: [
        ["Name", "Value"],
        ["Rate limit", "100"],
      ],
    });
    expect((table as { html: string }).html).toContain("<table");

    expect(code).toMatchObject({
      type: "code",
      anchor: "example",
      headingPath: ["Reference", "API"],
      codeLanguage: "ts",
    });
    expect(code?.text).toContain("console.log");
  });

  it("extracts paragraph elements with normalized text", () => {
    const html = `
      <html>
        <head><title>Paragraph Guide</title></head>
        <body>
          <article>
            <h1 id="intro">Intro</h1>
            <p>
              This paragraph has
              extra spacing that should be normalized.
            </p>
          </article>
        </body>
      </html>
    `;

    const parsed = parseHTMLToStructuredDocument(html, "https://example.com/docs/en-us/guide/paragraphs");
    const paragraph = parsed.elements.find((element) => element.type === "paragraph");

    expect(paragraph).toMatchObject({
      type: "paragraph",
      text: "This paragraph has extra spacing that should be normalized.",
      headingPath: ["Paragraph Guide", "Intro"],
    });
  });

  it("extracts ordered and unordered lists as structured list elements", () => {
    const html = `
      <html>
        <head><title>List Guide</title></head>
        <body>
          <article>
            <h1 id="steps">Steps</h1>
            <ol>
              <li>Install dependencies</li>
              <li>Run the server</li>
            </ol>
            <ul>
              <li>Read the docs</li>
              <li>Review examples</li>
            </ul>
          </article>
        </body>
      </html>
    `;

    const parsed = parseHTMLToStructuredDocument(html, "https://example.com/docs/en-us/guide/lists");
    const lists = parsed.elements.filter((element) => element.type === "list");

    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({
      type: "list",
      listKind: "ordered",
      items: ["Install dependencies", "Run the server"],
    });
    expect(lists[1]).toMatchObject({
      type: "list",
      listKind: "unordered",
      items: ["Read the docs", "Review examples"],
    });
  });
});
