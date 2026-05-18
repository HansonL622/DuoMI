import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let localEnv: Record<string, string> | null = null;

function parseEnvFile(content: string): Record<string, string> {
  return content.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return acc;

    const rawValue = match[2].trim();
    acc[match[1]] = rawValue.replace(/^["']|["']$/g, '');
    return acc;
  }, {});
}

function getLocalEnv(): Record<string, string> {
  if (localEnv) return localEnv;

  try {
    localEnv = parseEnvFile(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8'));
  } catch {
    localEnv = {};
  }

  return localEnv;
}

export function getEnv(name: string): string {
  return process.env[name] || getLocalEnv()[name] || '';
}
