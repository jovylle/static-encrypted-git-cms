#!/usr/bin/env node
import process from 'process';
import { validateSourceData } from './lib/validate-data.mjs';

const { ok, errors } = await validateSourceData();

for (const line of errors) {
  if (line.startsWith('SKIP')) console.warn(line);
  else console.error(line);
}

if (ok) {
  console.log('All manifest collections are valid.');
} else {
  process.exitCode = 1;
}
