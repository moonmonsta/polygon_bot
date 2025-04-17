export class Logger {
  info(message: string): void { console.log(`[INFO] ${new Date().toISOString()} - ${message}`); }
  debug(message: string): void { console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`); }
  warn(message: string): void { console.log(`[WARN] ${new Date().toISOString()} - ${message}`); }
  error(message: string): void { console.error(`[ERROR] ${new Date().toISOString()} - ${message}`); }
}
export const logger = new Logger();
