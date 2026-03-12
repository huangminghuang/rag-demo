import { Client } from "pg";
import { execSync } from "child_process";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    console.log("Connecting to database for pre-migration setup...");
    await client.connect();
    
    console.log("Ensuring pgvector extension is enabled...");
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    
    await client.end();
    console.log("Pre-migration setup complete.");

    console.log("Running Drizzle migrations (push)...");
    execSync("npx drizzle-kit push", { stdio: "inherit" });
    
    console.log("Migration successful!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main();
