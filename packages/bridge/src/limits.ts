/** Hard limits for extension → bridge payloads (bytes / counts). */
export const BRIDGE_DEFAULT_PORT = 17432;
export const BRIDGE_MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MiB
export const BRIDGE_MAX_INSTRUCTION_CHARS = 8_000;
export const BRIDGE_MAX_SELECTED_TEXT_CHARS = 50_000;
export const BRIDGE_MAX_TITLE_CHARS = 2_000;
export const BRIDGE_MAX_SCREENSHOTS = 3;
export const BRIDGE_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Phase B — local file handoff caps */
export const BRIDGE_MAX_FILE_SOURCES = 10;
export const BRIDGE_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB per file
export const BRIDGE_MAX_FILES_TOTAL_BYTES = 80 * 1024 * 1024; // 80 MiB total
export const BRIDGE_MAX_TEXT_EXCERPT_CHARS = 20_000;
