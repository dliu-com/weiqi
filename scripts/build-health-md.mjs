// Writes src/health.md (published as /docs/health.md) from the same data as the /docs/health page.
import {writeFileSync} from 'node:fs';import {healthMarkdown} from '../src/health-spec.js';
writeFileSync(new URL('../src/health.md',import.meta.url),healthMarkdown());
