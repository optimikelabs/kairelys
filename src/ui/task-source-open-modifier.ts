import { Platform } from 'obsidian';

export interface TaskSourceOpenModifierEvent {
	metaKey: boolean;
	ctrlKey: boolean;
}

export function isTaskSourceOpenModifierClick(
	event: TaskSourceOpenModifierEvent,
	isMacOS = Platform.isMacOS,
): boolean {
	return isMacOS ? event.metaKey : event.ctrlKey;
}
