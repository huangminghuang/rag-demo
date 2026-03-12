import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  try {
    // The SDK doesn't have a direct listModels, we usually use the REST API or 
    // just try a different name. 
    // Let's try text-embedding-004 again but with a different check.
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    console.log("Model initialized. Testing embedding...");
    const result = await model.embedContent("test");
    console.log("Success! Embedding generated.");
  } catch (error) {
    console.error("Error with text-embedding-004:", error);
    console.log("\nAttempting to find alternative models...");
    // Fallback to text-embedding-004's predecessor or check naming
  }
}

main();
