/** Hard limits for extension → bridge payloads (bytes / counts). */
export const BRIDGE_DEFAULT_PORT = 17432;
export const BRIDGE_MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MiB
export const BRIDGE_MAX_INSTRUCTION_CHARS = 8_000;
export const BRIDGE_MAX_SELECTED_TEXT_CHARS = 50_000;
export const BRIDGE_MAX_TITLE_CHARS = 2_000;
export const BRIDGE_MAX_SCREENSHOTS = 3;
export const BRIDGE_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
