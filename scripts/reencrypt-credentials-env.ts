import { config } from "dotenv";

/**
 * Imported first by scripts/reencrypt-credentials.ts, so it runs before any
 * other module reads the environment. It keeps a copy of the environment
 * exactly as the terminal set it, then loads .env for anything still unset
 * (DATABASE_URL has to be in place before src/lib/prisma is imported). The
 * script compares the two with requireKeysFromTerminal, so the encryption keys
 * can only come from the terminal, never from .env.
 */
export const terminalEnv: Readonly<Record<string, string | undefined>> = { ...process.env };

config();
