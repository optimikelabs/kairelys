import { EditorPosition } from 'obsidian';

export type EphemeralFieldSessionStatus = 'pending' | 'picker_open' | 'committed' | 'cancelled';

export type EphemeralFieldSessionCancelReason =
	| 'replaced'
	| 'picker_cancelled'
	| 'picker_closed'
	| 'selection_moved'
	| 'file_changed'
	| 'plugin_unload'
	| 'committed';

export interface EphemeralFieldSessionRange {
	start: EditorPosition;
	end: EditorPosition;
}

export interface EphemeralFieldSession {
	id: string;
	canonicalKey: string;
	visibleName: string;
	filePath: string;
	lineNumber: number;
	triggerRange: EphemeralFieldSessionRange;
	resumeCursor: EditorPosition;
	status: EphemeralFieldSessionStatus;
	createdAt: number;
	cancelReason: EphemeralFieldSessionCancelReason | null;
}

export interface BeginEphemeralFieldSessionInput {
	canonicalKey: string;
	visibleName: string;
	filePath: string;
	lineNumber: number;
	triggerRange: EphemeralFieldSessionRange;
	resumeCursor: EditorPosition;
}

export function shouldAbandonLivePreviewSessionForWorkspaceFile(
	session: EphemeralFieldSession,
	nextFilePath: string | null,
): boolean {
	if (nextFilePath === session.filePath) return false;
	if (!nextFilePath && session.status === 'picker_open') return false;
	return true;
}

/**
 * Single-active-session controller for Live Preview inline field authoring.
 * Phase 1 only establishes state and lifecycle; commit wiring comes later.
 */
export class LivePreviewEphemeralSessionController {
	private activeSession: EphemeralFieldSession | null = null;

	begin(input: BeginEphemeralFieldSessionInput): EphemeralFieldSession {
		if (this.activeSession) {
			this.cancel('replaced');
		}

		const session: EphemeralFieldSession = {
			id: `lpfs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			canonicalKey: input.canonicalKey,
			visibleName: input.visibleName,
			filePath: input.filePath,
			lineNumber: input.lineNumber,
			triggerRange: input.triggerRange,
			resumeCursor: input.resumeCursor,
			status: 'pending',
			createdAt: Date.now(),
			cancelReason: null,
		};

		this.activeSession = session;
		return session;
	}

	getActive(): EphemeralFieldSession | null {
		return this.activeSession;
	}

	markPickerOpen(sessionId: string): EphemeralFieldSession | null {
		if (!this.activeSession || this.activeSession.id !== sessionId) return null;
		this.activeSession.status = 'picker_open';
		return this.activeSession;
	}

	commit(sessionId: string): EphemeralFieldSession | null {
		if (!this.activeSession || this.activeSession.id !== sessionId) return null;
		this.activeSession.status = 'committed';
		this.activeSession.cancelReason = 'committed';
		const committed = this.activeSession;
		this.activeSession = null;
		return committed;
	}

	cancel(reason: EphemeralFieldSessionCancelReason): EphemeralFieldSession | null {
		if (!this.activeSession) return null;
		this.activeSession.status = 'cancelled';
		this.activeSession.cancelReason = reason;
		const cancelled = this.activeSession;
		this.activeSession = null;
		return cancelled;
	}

	cancelIfContextChanged(filePath: string, lineNumber: number): EphemeralFieldSession | null {
		if (!this.activeSession) return null;
		if (this.activeSession.filePath === filePath && this.activeSession.lineNumber === lineNumber) {
			return null;
		}
		return this.cancel('selection_moved');
	}
}
