export interface ProcessRow { pid: number; ppid: number; command: string }
export function readProcessRows(): ProcessRow[]
export function processDescendants(rootPid: number, rows: ProcessRow[]): ProcessRow[]
export function matchingProcesses(initial: ProcessRow[], current: ProcessRow[]): ProcessRow[]
