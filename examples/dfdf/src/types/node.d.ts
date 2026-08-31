declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function readFileSync(path: string, encoding: string): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function copyFileSync(src: string, dest: string): void;
}

declare module 'path' {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare namespace performance {
  function now(): number;
}

declare var process: {
  exit(code?: number): never;
  cwd(): string;
};
