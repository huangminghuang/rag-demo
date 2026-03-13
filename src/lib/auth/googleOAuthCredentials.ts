import fs from "node:fs";
import path from "node:path";

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  source: "env" | "file";
}

interface GoogleOAuthJsonShape {
  client_id?: string;
  client_secret?: string;
  web?: {
    client_id?: string;
    client_secret?: string;
  };
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
}

let cachedCredentials: GoogleOAuthCredentials | null = null;

function readCredentialsFromFile(filePath: string): GoogleOAuthCredentials | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content) as GoogleOAuthJsonShape;

  const clientId = parsed.client_id || parsed.web?.client_id || parsed.installed?.client_id;
  const clientSecret = parsed.client_secret || parsed.web?.client_secret || parsed.installed?.client_secret;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    source: "file",
  };
}

export function getGoogleOAuthCredentials(): GoogleOAuthCredentials {
  if (cachedCredentials) return cachedCredentials;

  const envClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (envClientId && envClientSecret) {
    cachedCredentials = {
      clientId: envClientId,
      clientSecret: envClientSecret,
      source: "env",
    };
    return cachedCredentials;
  }

  const fallbackPath = process.env.GOOGLE_OAUTH_JSON_PATH || ".secrets/google_oauth.json";
  const resolvedPath = path.resolve(process.cwd(), fallbackPath);
  const fileCredentials = readCredentialsFromFile(resolvedPath);

  if (fileCredentials) {
    cachedCredentials = fileCredentials;
    return fileCredentials;
  }

  throw new Error(
    `Google OAuth credentials not found. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or provide a valid JSON at ${resolvedPath}.`
  );
}
