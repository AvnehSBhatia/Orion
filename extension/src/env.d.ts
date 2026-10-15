// Set by build.mjs with esbuild's define.

/** The default Orion server for this build (ORION_SERVER_URL, or http://localhost:3001 in dev builds). */
declare const __ORION_SERVER_URL__: string;
/** True for dev builds, false for store builds. */
declare const __ORION_DEV__: boolean;
