import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SWAGGER_URL = process.env.FITEPIC_SWAGGER_URL ?? 'http://localhost:5244/swagger/v1/swagger.json';
const OUTPUT = resolve(__dirname, '..', 'api', 'swagger.json');

async function main() {
  console.log(`Fetching swagger from ${SWAGGER_URL}`);
  const res = await fetch(SWAGGER_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch swagger: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  JSON.parse(text);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, text, 'utf8');
  console.log(`Wrote ${OUTPUT} (${text.length} bytes)`);
}

main().catch((err) => {
  console.error(err.message);
  console.error('Tip: ensure the API is running, or run "npm run gen:api:offline" to use the existing snapshot.');
  process.exit(1);
});
