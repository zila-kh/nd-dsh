export interface ProcessRow { pid: number; ppid: number; command: string; startedAt?: number }
export function readProcessRows(): ProcessRow[]
export function processDescendants(rootPid: number, rows: ProcessRow[]): ProcessRow[]
export function matchingProcesses(initial: ProcessRow[], current: ProcessRow[]): ProcessRow[]
