/**
 * Thin client for the Azure gpt-image-2 deployment.
 *
 * Reads GPT_IMAGE_API (full generations URL, api-version included) and
 * GPT_IMAGE_KEY from the environment. Results are cached on disk by a hash of
 * the request so re-running the asset build is free and deterministic.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface GenerateOptions {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  cacheDir: string;
  /** Redraw even if this exact prompt is already cached. */
  bypassCache?: boolean;
}

interface AzureImageResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

const MAX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait before retrying a throttled request. Azure puts the answer
 * in the Retry-After header, and repeats it in prose in the error message when
 * the header is missing.
 */
function retryDelayMs(res: Response, message: string, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return (header + 1) * 1000;

  const prose = /retry after (\d+) seconds?/i.exec(message);
  if (prose) return (Number(prose[1]) + 1) * 1000;

  return 2000 * 2 ** (attempt - 1);
}

export async function generateImage(opts: GenerateOptions): Promise<Buffer> {
  const { prompt, size = '1024x1024', quality = 'medium', cacheDir, bypassCache } = opts;

  const endpoint = process.env.GPT_IMAGE_API;
  const key = process.env.GPT_IMAGE_KEY;
  if (!endpoint || !key) {
    throw new Error('GPT_IMAGE_API and GPT_IMAGE_KEY must be set in the environment');
  }

  const hash = createHash('sha256')
    .update(JSON.stringify({ prompt, size, quality }))
    .digest('hex')
    .slice(0, 16);

  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${hash}.png`);

  if (!bypassCache) {
    try {
      return await readFile(cachePath);
    } catch {
      // cache miss, fall through to the API
    }
  }

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, n: 1, size, quality }),
      });
    } catch (err) {
      lastError = `network: ${(err as Error).message}`;
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }

    const body = (await res.json().catch(() => ({}))) as AzureImageResponse;

    if (res.ok) {
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error('image response contained no b64_json payload');
      const buf = Buffer.from(b64, 'base64');
      await writeFile(cachePath, buf);
      return buf;
    }

    const message = body.error?.message ?? 'unknown error';
    lastError = `HTTP ${res.status}: ${message}`;

    // 4xx other than rate limiting will not get better by trying again.
    if (res.status !== 429 && res.status < 500) break;
    await sleep(retryDelayMs(res, message, attempt));
  }

  throw new Error(`image generation failed — ${lastError}`);
}
