/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare module '*.md?raw' { const s: string; export default s; }
declare module '*.sql?raw' { const s: string; export default s; }
