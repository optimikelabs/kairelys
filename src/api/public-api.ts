export const OPERON_PUBLIC_API_VERSION = '1' as const;

export interface OperonPublicApiCapabilities {
	ready: boolean;
	create: boolean;
	update: boolean;
	transition: boolean;
	convert: boolean;
}

export interface OperonPublicMutationResult {
	ok: boolean;
	operonId: string | null;
	code: 'applied' | 'not-ready' | 'not-found' | 'invalid-input' | 'rejected' | 'failed';
	message?: string;
}

export interface OperonPublicCreateTaskInput {
	source: 'inline' | 'file';
	description: string;
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
	status: string;
}

export interface OperonPublicConvertTaskInput {
	target: 'inline' | 'file';
	fileTemplateId?: string;
	targetPath?: string;
}

export interface OperonPublicApiV1 {
	version: typeof OPERON_PUBLIC_API_VERSION;
	capabilities(): OperonPublicApiCapabilities;
	createTask(input: OperonPublicCreateTaskInput): Promise<OperonPublicMutationResult>;
	updateTask(operonId: string, input: OperonPublicUpdateTaskInput): Promise<OperonPublicMutationResult>;
	transitionTask(operonId: string, input: OperonPublicTransitionTaskInput): Promise<OperonPublicMutationResult>;
	convertTask(operonId: string, input: OperonPublicConvertTaskInput): Promise<OperonPublicMutationResult>;
}
