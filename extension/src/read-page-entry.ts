// Bundled as dist/read-page.js and injected into allowed tabs. Defines
// globalThis.__orionReadPage in the extension's isolated world; the service
// worker then calls it with a second, tiny injection (see background/sources.ts).
import { installReadPage } from './background/read-page.ts';

installReadPage();
