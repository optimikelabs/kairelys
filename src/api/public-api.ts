export const OPERON_PUBLIC_API_VERSION = '1' as const;

export interface OperonPublicApiCapabilities {
	ready: boolean;
	adopt: boolean;
	create: boolean;
	update: boolean;
	transition: boolean;
	convert: boolean;
}

export interface OperonPublicMutationResult {
	ok: boolean;
	operonId: string | null;
	code: 'applied' | 'not-ready' | 'not-found' | 'invalid-input' | 'conflict' | 'rejected' | 'failed';
	message?: string;
}

export interface OperonPublicAdoptInlineTaskInput {
	targetPath: string;
	/** One-based source line, matching the public task projection. */
	line: number;
	/** Exact source-line precondition. Prevents adopting a stale or moved checkbox. */
	expectedLine: string;
	/** Optional stable configured status id. */
	statusId?: string;
}

export interface OperonPublicCreateTaskInput {
	source: 'inline' | 'file';
	description: string;
	/** Stable configured status id, independent from pipeline/status display language. */
	statusId?: string;
	tags?: string[];
	fields?: Record<string, string>;
	properties?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
	fileTemplateId?: string;
	targetDateKey?: string;
	targetFolder?: string;
	targetPath?: string;
}

export interface OperonPublicUpdateTaskInput {
	fields?: Record<string, string>;
	properties?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
	description?: string;
	tags?: string[];
}

export interface OperonPublicTransitionTaskInput {
	/** Exact configured `Pipeline.Status` value. */
	status?: string;
	/** Stable configured status id, independent from pipeline/status display language. */
	statusId?: string;
}

export interface OperonPublicConvertTaskInput {
	target: 'inline' | 'file';
	fileTemplateId?: string;
	targetPath?: string;
	targetFolder?: string;
}

export interface OperonPublicApiV1 {
	version: typeof OPERON_PUBLIC_API_VERSION;
	capabilities(): OperonPublicApiCapabilities;
	adoptInlineTask(input: OperonPublicAdoptInlineTaskInput): Promise<OperonPublicMutationResult>;
	createTask(input: OperonPublicCreateTaskInput): Promise<OperonPublicMutationResult>;
	updateTask(operonId: string, input: OperonPublicUpdateTaskInput): Promise<OperonPublicMutationResult>;
	transitionTask(operonId: string, input: OperonPublicTransitionTaskInput): Promise<OperonPublicMutationResult>;
	convertTask(operonId: string, input: OperonPublicConvertTaskInput): Promise<OperonPublicMutationResult>;
}
