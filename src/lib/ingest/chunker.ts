export interface Chunk {
  content: string;
  chunkIndex: number;
  anchor?: string;
  metadata: Record<string, any>;
}

/**
 * A simple chunker that splits text by sections (headings).
 * For this demo, we'll implement a basic version that ensures we stay 
 * within reasonable token limits (approx 600-900 tokens).
 * 1 token is roughly 4 characters in English.
 */
export function chunkDocument(
  content: string,
  title: string,
  headings: { level: number; text: string; anchor: string }[]
): Chunk[] {
  const chunks: Chunk[] = [];
  
  // Create sections based on headings
  // We add a virtual 'Introduction' section at the start for content before the first heading
  const sections: { text: string; anchor: string; start: number }[] = [
    { text: "Introduction", anchor: "", start: 0 }
  ];

  let lastFoundIndex = 0;
  for (const h of headings) {
    const index = content.indexOf(h.text, lastFoundIndex);
    if (index !== -1) {
      // If this is the first real heading, and it's at the very start, 
      // it might replace our virtual 'Introduction'
      if (sections.length === 1 && index === 0) {
        sections[0] = { text: h.text, anchor: h.anchor, start: 0 };
      } else {
        sections.push({ text: h.text, anchor: h.anchor, start: index });
      }
      lastFoundIndex = index + h.text.length;
    }
  }

  let currentChunkIndex = 0;
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    const sectionEnd = next ? next.start : content.length;
    const sectionText = content.substring(current.start, sectionEnd).trim();

    if (sectionText.length < 50 && i < sections.length - 1) {
       // Too short to be a useful chunk alone, skip or it will be merged by proximity 
       // in a more advanced chunker. For now, just continue.
       continue;
    }

    // Split large sections into manageable pieces
    const subSections = splitText(sectionText, 3500, 500);
    
    for (const subSection of subSections) {
      chunks.push({
        content: `Document: ${title}\nSection: ${current.text}\n\n${subSection}`,
        chunkIndex: currentChunkIndex++,
        anchor: current.anchor || undefined,
        metadata: { 
          source_title: title,
          section_title: current.text,
          length: subSection.length
        }
      });
    }
  }

  return chunks;
}

function splitText(text: string, maxLength: number, overlap: number): string[] {
  const result: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLength;
    if (end > text.length) end = text.length;

    // Try to find a good breaking point (newline or period)
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start + (maxLength / 2)) {
        end = lastNewline;
      } else {
        const lastPeriod = text.lastIndexOf(". ", end);
        if (lastPeriod > start + (maxLength / 2)) {
          end = lastPeriod + 1;
        }
      }
    }

    result.push(text.substring(start, end).trim());
    start = end - overlap;
    
    // Prevent infinite loop if overlap >= maxLength
    if (start >= end) break;
    if (end === text.length) break;
  }

  return result;
}
