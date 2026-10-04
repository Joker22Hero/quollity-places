import { readFile, unlink } from 'node:fs/promises';
const generated = await readFile(
  new URL('../worker-configuration.d.ts', import.meta.url),
  'utf8',
);
if (generated.includes('// Begin runtime types')) {
  await unlink(new URL('../worker/runtime.d.ts', import.meta.url)).catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
}
