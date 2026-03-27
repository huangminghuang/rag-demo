import fs from "node:fs";
import path from "node:path";
import type { QueryRewriteEligibilityReason } from "./queryRewrite";

export interface QueryRewriteMatrixCase {
  id: string;
  category: string;
  query: string;
  expectedEligibility: {
    eligible: boolean;
    reason: QueryRewriteEligibilityReason;
  };
}

const DOCUMENTED_TEST_MATRIX_PATH = path.resolve(
  process.cwd(),
  "docs/features/query-rewrite/TEST_QUERIES.md",
);

// Remove whole-cell Markdown code formatting without touching inline code inside prose.
function stripWholeCellCodeFence(value: string): string {
  const trimmedValue = value.trim();
  if (/^`[^`]+`$/.test(trimmedValue)) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

// Convert the Markdown table expectation into the rewrite gate outcome used by tests.
function parseExpectedEligibility(rawValue: string): QueryRewriteMatrixCase["expectedEligibility"] {
  const normalizedValue = stripWholeCellCodeFence(rawValue);
  if (normalizedValue === "apply") {
    return { eligible: true, reason: "eligible" };
  }

  const skipPrefix = "skip ";
  if (!normalizedValue.startsWith(skipPrefix)) {
    throw new Error(`Unsupported query rewrite expectation: ${rawValue}`);
  }

  const reason = stripWholeCellCodeFence(
    normalizedValue.slice(skipPrefix.length),
  ) as QueryRewriteEligibilityReason;
  return { eligible: false, reason };
}

// Read the documented test matrix so the docs remain the executable source of truth.
function parseMarkdownTestMatrix(markdown: string): QueryRewriteMatrixCase[] {
  const lines = markdown.split(/\r?\n/);
  const tableHeaderIndex = lines.findIndex((line) => line.trim() === "| ID | Category | Expected Rewrite | Query |");

  if (tableHeaderIndex === -1) {
    throw new Error("Could not find query rewrite test matrix table in docs/features/query-rewrite/TEST_QUERIES.md");
  }

  const matrixCases: QueryRewriteMatrixCase[] = [];

  for (const line of lines.slice(tableHeaderIndex + 2)) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("|")) {
      break;
    }

    const cells = trimmedLine
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 4) {
      throw new Error(`Unexpected query rewrite matrix row: ${line}`);
    }

    const [id, category, expectedRewrite, query] = cells;
    matrixCases.push({
      id,
      category,
      query: stripWholeCellCodeFence(query),
      expectedEligibility: parseExpectedEligibility(expectedRewrite),
    });
  }

  return matrixCases;
}

export function loadDocumentedQueryRewriteMatrix(
  docPath: string = DOCUMENTED_TEST_MATRIX_PATH,
): QueryRewriteMatrixCase[] {
  return parseMarkdownTestMatrix(fs.readFileSync(docPath, "utf8"));
}
