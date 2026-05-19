import { OperonSettings } from '../types/settings';

export interface TaskFieldSuggestionItem {
	canonicalKey: string;
	visibleName: string;
}

export interface TaskFieldTriggerMatch {
	token: string;
	start: number;
	end: number;
}

export type TaskFieldSuggestionSuppressionReason =
	| 'no-trigger'
	| 'token-too-short'
	| 'no-items'
	| 'not-task-line'
	| 'not-live-preview'
	| 'not-operon-task'
	| 'composition-active'
	| 'picker-active'
	| 'session-cancelled';

export interface TaskFieldSuggestionResolution {
	trigger: TaskFieldTriggerMatch | null;
	token: string;
	items: TaskFieldSuggestionItem[];
	suppressionReason: TaskFieldSuggestionSuppressionReason | null;
}

const TASK_FIELD_TRIGGER_RE = /(?:^|[\s([{;,])([\p{L}][\p{L}\p{N}_-]*)$/u;

function matchTaskFieldTriggerCandidate(beforeCaret: string): TaskFieldTriggerMatch | null {
	const match = TASK_FIELD_TRIGGER_RE.exec(beforeCaret);
	if (!match) return null;

	const token = match[1];
	return {
		token,
		start: beforeCaret.length - token.length,
		end: beforeCaret.length,
	};
}

export function matchTaskFieldTrigger(beforeCaret: string): TaskFieldTriggerMatch | null {
	const candidate = matchTaskFieldTriggerCandidate(beforeCaret);
	if (!candidate || candidate.token.length < 2) return null;
	return candidate;
}

export function buildTaskFieldSuggestions(
	token: string,
	settings: OperonSettings,
	currentFieldValues: Record<string, string>,
): TaskFieldSuggestionItem[] {
	const lowered = token.toLocaleLowerCase();
	const unique = new Map<string, TaskFieldSuggestionItem>();

	for (const mapping of settings.keyMappings) {
		if (mapping.isInternal) continue;
		if (!mapping.visiblePropertyName) continue;
		if (!mapping.visiblePropertyName.toLocaleLowerCase().startsWith(lowered)) continue;

		const key = mapping.visiblePropertyName.toLocaleLowerCase();
		if (!unique.has(key)) {
			unique.set(key, {
				canonicalKey: mapping.canonicalKey,
				visibleName: mapping.visiblePropertyName,
			});
		}
	}

	if ('tags'.startsWith(lowered) && !unique.has('tags')) {
		unique.set('tags', {
			canonicalKey: 'tags',
			visibleName: 'tags',
		});
	}

	if (!(currentFieldValues['datetimeStart'] ?? '').trim()) {
		for (const [key, item] of [...unique.entries()]) {
			if (item.canonicalKey === 'datetimeEnd') {
				unique.delete(key);
			}
		}
	}

	return [...unique.values()]
		.sort((a, b) => {
			const exactA = a.visibleName.length === token.length ? 0 : 1;
			const exactB = b.visibleName.length === token.length ? 0 : 1;
			if (exactA !== exactB) return exactA - exactB;
			if (a.visibleName.length !== b.visibleName.length) return a.visibleName.length - b.visibleName.length;
			return a.visibleName.localeCompare(b.visibleName, undefined, { sensitivity: 'base' });
		})
		.slice(0, 8);
}

export function resolveTaskFieldSuggestions(
	beforeCaret: string,
	settings: OperonSettings,
	currentFieldValues: Record<string, string>,
): TaskFieldSuggestionResolution {
	const candidate = matchTaskFieldTriggerCandidate(beforeCaret);
	if (!candidate) {
		return {
			trigger: null,
			token: '',
			items: [],
			suppressionReason: 'no-trigger',
		};
	}

	if (candidate.token.length < 2) {
		return {
			trigger: null,
			token: candidate.token,
			items: [],
			suppressionReason: 'token-too-short',
		};
	}

	const items = buildTaskFieldSuggestions(candidate.token, settings, currentFieldValues);
	return {
		trigger: candidate,
		token: candidate.token,
		items,
		suppressionReason: items.length > 0 ? null : 'no-items',
	};
}

export function isParsedTaskFieldSuggestionTarget(
	parsed: { operonId: string | null; fields: readonly unknown[] } | null,
): boolean {
	return Boolean(parsed && (parsed.operonId || parsed.fields.length > 0));
}

export function isTaskFieldSuggestionDebugEnabled(): boolean {
	const debugWindow = window as Window & { OPERON_DEBUG_FIELD_SUGGESTIONS?: unknown };
	return debugWindow.OPERON_DEBUG_FIELD_SUGGESTIONS === true;
}

export function debugTaskFieldSuggestion(
	surface: 'live-preview' | 'task-creator',
	reason: TaskFieldSuggestionSuppressionReason,
	context: Record<string, unknown> = {},
): void {
	if (reason === 'no-trigger' || !isTaskFieldSuggestionDebugEnabled()) return;
	console.debug('[Operon] field suggestion', { surface, reason, ...context });
}
