export type Status = 'pending'|'done'|'failed';
export interface Item { status: Status; error?: string|null; [key:string]: unknown }
export interface Pipeline { project_id:string; characters:Item[]; backgrounds:Item[]; scenes:Item[]; [key:string]: any }
