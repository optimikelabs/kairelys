/**
 * Direct task writer for Operon.
 * Writes field values directly to a task's source file (inline or YAML).
 * No sync, no locks, no debounce — just a clean write to the single task instance.
 *
 * Replaces SyncEngine.scheduleSync() for systems that need to update
 * other tasks' files (dependency manager, progress calculator, etc.).
 */

import { App, TFile } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';

import { parseTaskLine } from './parser';
import { serializeTask } from './serializer';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { IndexedTask, OperonField } from '../types/fields';
import { KeyMapping } from '../types/settings';
import {
	applyYamlTaskFieldValues,
	normalizeYamlFrontmatterFormatting,
	tryPatchAggregateYamlFrontmatter,
	YamlFrontmatterFormattingPlan,
} from './task-writer-yaml';
import { getManagedYamlAliases } from './yaml-fields';
import { resolveYamlTaskCreatedBackfillValue } from './yaml-task-file-stat-sync';
import { WriteQueue } from '../storage/write-queue';
import { enginePerfLog, enginePerfNow } from './engine-perf';

export interface TaskWriteOptions {
    mode?: 'merge' | 'replace';
    reindex?: 'scheduled' | 'none';
    touchAncestors?: boolean;
    yamlAggregateFastPath?: boolean;
}

export interface TaskWriterHooks {
    onBeforeWriteFile?: (filePath: string) => void;
    onDuplicateConflict?: (operonId: string) => void;
}

type YamlFastPathState = 'aggregate' | 'fallback' | 'none';

interface TaskWriteResult {
    wrote: boolean;
    yamlFastPath: YamlFastPathState;
    fallbackReason: string;
}

export interface InlineTaskLinePatchResult {
    ok: boolean;
    content: string;
    fallbackReason: string;
}

export interface SameFileInlineYamlAggregateWriteResult {
    wrote: boolean;
    fallbackReason: string;
}

function findTaskLineIndex(
    lines: string[],
    filePath: string,
    operonId: string,
    lineHint: number,
    keyMappings: KeyMapping[],
): number {
    if (lineHint >= 0 && lineHint < lines.length) {
        const hinted = parseTaskLine(lines[lineHint], lineHint, filePath, keyMappings);
        if (hinted?.operonId === operonId) {
            return lineHint;
        }
    }

    const matches: number[] = [];
    for (let index = 0; index < lines.length; index++) {
        const parsed = parseTaskLine(lines[index], index, filePath, keyMappings);
        if (parsed?.operonId === operonId) {
            matches.push(index);
        }
    }
    if (matches.length === 0) return -1;

    let best = matches[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of matches) {
        const distance = Math.abs(index - lineHint);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    }
    return best;
}

export function tryPatchInlineTaskLineContent(
    content: string,
    filePath: string,
    operonId: string,
    fieldValues: Record<string, string>,
    lineHint: number,
    mode: 'merge' | 'replace',
    keyMappings: KeyMapping[] = [],
): InlineTaskLinePatchResult {
    const lines = content.split('\n');
    const taskLineIndex = findTaskLineIndex(lines, filePath, operonId, lineHint, keyMappings);
    if (taskLineIndex === -1) {
        return { ok: false, content, fallbackReason: 'inline-task-not-found' };
    }

    const parsed = parseTaskLine(lines[taskLineIndex], taskLineIndex, filePath, keyMappings);
    if (!parsed) {
        return { ok: false, content, fallbackReason: 'inline-task-parse-failed' };
    }

    const canonicalFieldMap = new Map<string, OperonField>();
    for (const field of parsed.fields) {
        const canonicalKey = field.key;
        if (canonicalKey === 'pinned') continue;
        if (canonicalKey === 'tags') continue;
        const def = CANONICAL_KEY_MAP.get(canonicalKey);
        canonicalFieldMap.set(canonicalKey, {
            ...field,
            key: canonicalKey,
            type: def?.type ?? field.type,
            isCanonical: !!def,
        });
    }
    parsed.fields = Array.from(canonicalFieldMap.values());

    if ('_description' in fieldValues) {
        parsed.description = fieldValues['_description'];
    }
    if ('_tags' in fieldValues) {
        parsed.tags = fieldValues['_tags']
            ? fieldValues['_tags'].split(';').map(tag => tag.trim()).filter(Boolean)
            : [];
    }
    if ('_checkbox' in fieldValues) {
        parsed.checkbox = fieldValues['_checkbox'] as 'open' | 'done' | 'cancelled';
    }

    for (const [key, value] of Object.entries(fieldValues)) {
        if (key.startsWith('_')) continue;
        if (key === 'pinned') continue;

        const existing = parsed.fields.find(f => f.key === key);
        if (value === '') {
            parsed.fields = parsed.fields.filter(f => f.key !== key);
        } else if (existing) {
            existing.value = value;
            existing.rawValue = value;
        } else if (value) {
            const def = CANONICAL_KEY_MAP.get(key);
            parsed.fields.push({
                sourceKey: key,
                key,
                value,
                rawValue: value,
                type: def?.type ?? 'text',
                isCanonical: !!def,
                containerRange: { from: 0, to: 0 },
                valueRange: { from: 0, to: 0 },
            });
        }
    }

    if (mode === 'replace') {
        const incomingKeys = new Set(
            Object.keys(fieldValues).filter(key => !key.startsWith('_'))
        );
        parsed.fields = parsed.fields.filter(f => {
            if (incomingKeys.has(f.key)) return true;
            if (f.key === 'operonId' || f.key === 'datetimeCreated' || f.key === 'related') return true;
            return false;
        });
    }

    lines[taskLineIndex] = serializeTask(parsed, keyMappings);
    return { ok: true, content: lines.join('\n'), fallbackReason: 'none' };
}

export class TaskWriter {
    private app: App;
    private indexer: OperonIndexer;
    private keyMappings: KeyMapping[];
    private hooks: TaskWriterHooks;
    private fileWriteQueue = new WriteQueue();

    constructor(app: App, indexer: OperonIndexer, keyMappings: KeyMapping[], hooks: TaskWriterHooks = {}) {
        this.app = app;
        this.indexer = indexer;
        this.keyMappings = keyMappings;
        this.hooks = hooks;
    }

    /** Update key mappings when settings change. */
    updateKeyMappings(keyMappings: KeyMapping[]): void {
        this.keyMappings = keyMappings;
    }

    private stringifyFrontmatterScalar(value: unknown): string | null {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return null;
    }

    /**
     * Write field values to a task's source file.
     * Looks up the task in the index, determines format (inline/yaml),
     * and writes directly to the file. Triggers reindex afterward.
     */
    async writeTaskFields(
        operonId: string,
        fieldValues: Record<string, string>,
        options: TaskWriteOptions = {},
    ): Promise<boolean> {
        const startedAt = enginePerfNow();
        const task = this.indexer.getTask(operonId);
        if (!task) {
            console.warn(`Operon TaskWriter [${operonId}]: task not found in index`);
            return false;
        }
        if (this.blockDuplicateConflict(operonId)) {
            console.warn(`Operon TaskWriter [${operonId}]: duplicate operonId conflict blocks direct write`);
            return false;
        }

        const location = task.primary;
        const file = this.app.vault.getAbstractFileByPath(location.filePath);
        if (!(file instanceof TFile)) {
            console.warn(`Operon TaskWriter [${operonId}]: file not found: ${location.filePath}`);
            return false;
        }

        const mode = options.mode ?? 'merge';
        const modifiedTimestamp = (fieldValues['datetimeModified'] ?? '').trim();
        const ancestorIds = modifiedTimestamp && options.touchAncestors !== false
            ? this.collectAffectedAncestorIdsForWrite(task, fieldValues, mode)
            : new Set<string>();

        this.hooks.onBeforeWriteFile?.(location.filePath);

        const writeResult = location.format === 'yaml'
            ? await this.writeYamlTask(file, operonId, fieldValues, mode, options)
            : {
                wrote: await this.writeInlineTask(file, operonId, fieldValues, location.lineNumber, mode),
                yamlFastPath: 'none' as const,
                fallbackReason: 'none',
            };
        if (!writeResult.wrote) {
            console.warn(`Operon TaskWriter [${operonId}]: task location could not be written: ${location.filePath}`);
            return false;
        }

        if (ancestorIds.size > 0 && modifiedTimestamp) {
            await this.touchAncestorModifiedTimestamps(ancestorIds, modifiedTimestamp);
        }

        if ((options.reindex ?? 'scheduled') === 'scheduled') {
            this.indexer.scheduleReindex(location.filePath);
        }
        enginePerfLog(
            'writeTaskFields',
            `${Math.round(enginePerfNow() - startedAt)}ms`,
            `task=${operonId}`,
            `file=${location.filePath}`,
            `fields=${Object.keys(fieldValues).join(',')}`,
            `yamlFastPath=${writeResult.yamlFastPath}`,
            `fallbackReason=${writeResult.fallbackReason}`,
        );
        return true;
    }

    async writeInlineTaskAndAggregateYamlParent(
        childOperonId: string,
        childPayload: Record<string, string>,
        parentOperonId: string,
        parentPayload: Record<string, string>,
        options: { mode?: 'merge' | 'replace' } = {},
    ): Promise<SameFileInlineYamlAggregateWriteResult> {
        const startedAt = enginePerfNow();
        const childTask = this.indexer.getTask(childOperonId);
        const parentTask = this.indexer.getTask(parentOperonId);
        if (!childTask || !parentTask) {
            return { wrote: false, fallbackReason: 'task-missing' };
        }
        if (this.blockDuplicateConflict(childOperonId) || this.blockDuplicateConflict(parentOperonId)) {
            return { wrote: false, fallbackReason: 'duplicate-operon-id-conflict' };
        }
        if (childTask.primary.format !== 'inline' || parentTask.primary.format !== 'yaml') {
            return { wrote: false, fallbackReason: 'format-mismatch' };
        }
        if (childTask.primary.filePath !== parentTask.primary.filePath) {
            return { wrote: false, fallbackReason: 'file-mismatch' };
        }
        if (childTask.primary.lineNumber === undefined) {
            return { wrote: false, fallbackReason: 'line-missing' };
        }

        const file = this.app.vault.getAbstractFileByPath(childTask.primary.filePath);
        if (!(file instanceof TFile)) {
            return { wrote: false, fallbackReason: 'file-missing' };
        }

        this.hooks.onBeforeWriteFile?.(file.path);
        const mode = options.mode ?? 'merge';
        const result = await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            const inlinePatch = tryPatchInlineTaskLineContent(
                content,
                file.path,
                childOperonId,
                childPayload,
                childTask.primary.lineNumber ?? -1,
                mode,
                this.keyMappings,
            );
            if (!inlinePatch.ok) {
                return { wrote: false, fallbackReason: inlinePatch.fallbackReason };
            }

            const yamlPatch = tryPatchAggregateYamlFrontmatter(
                inlinePatch.content,
                parentOperonId,
                parentPayload,
                this.keyMappings,
            );
            if (!yamlPatch.ok) {
                return { wrote: false, fallbackReason: `parent-${yamlPatch.fallbackReason}` };
            }

            if (yamlPatch.content !== content) {
                await this.app.vault.modify(file, yamlPatch.content);
            }
            return { wrote: true, fallbackReason: 'none' };
        });

        enginePerfLog(
            'writeTaskFieldsBatch',
            `${Math.round(enginePerfNow() - startedAt)}ms`,
            'sameFile=inline-yaml-aggregate',
            `file=${childTask.primary.filePath}`,
            `child=${childOperonId}`,
            `parent=${parentOperonId}`,
            `fields=child:${Object.keys(childPayload).join(',')}|parent:${Object.keys(parentPayload).join(',')}`,
            `fallbackReason=${result.fallbackReason}`,
        );
        return result;
    }

    /**
     * Touch the modified timestamp of every ancestor affected by a task mutation.
     * Walks parentTask upward only; descendants and siblings are never touched.
     */
    async touchTaskAncestorsModified(
        beforeTask: IndexedTask | null | undefined,
        afterTask: IndexedTask | null | undefined,
        timestamp: string,
    ): Promise<void> {
        const normalizedTimestamp = timestamp.trim();
        if (!normalizedTimestamp) return;

        const ancestorIds = new Set<string>();
        const blockedIds = new Set<string>();
        if (beforeTask?.operonId) blockedIds.add(beforeTask.operonId);
        if (afterTask?.operonId) blockedIds.add(afterTask.operonId);

        this.collectAncestorIdsFromParentId(beforeTask?.fieldValues['parentTask'] ?? '', ancestorIds, blockedIds);
        this.collectAncestorIdsFromParentId(afterTask?.fieldValues['parentTask'] ?? '', ancestorIds, blockedIds);

        await this.touchAncestorModifiedTimestamps(ancestorIds, normalizedTimestamp);
    }

    private collectAffectedAncestorIdsForWrite(
        task: IndexedTask,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
    ): Set<string> {
        const ancestorIds = new Set<string>();
        const blockedIds = new Set<string>([task.operonId]);
        const beforeParentId = task.fieldValues['parentTask'] ?? '';
        const afterParentId = this.resolveWrittenParentTaskId(task, fieldValues, mode);

        this.collectAncestorIdsFromParentId(beforeParentId, ancestorIds, blockedIds);
        this.collectAncestorIdsFromParentId(afterParentId, ancestorIds, blockedIds);

        return ancestorIds;
    }

    private resolveWrittenParentTaskId(
        task: IndexedTask,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
    ): string {
        if (Object.prototype.hasOwnProperty.call(fieldValues, 'parentTask')) {
            return fieldValues['parentTask'] ?? '';
        }
        if (mode === 'replace') {
            return '';
        }
        return task.fieldValues['parentTask'] ?? '';
    }

    private collectAncestorIdsFromParentId(
        parentId: string | null | undefined,
        output: Set<string>,
        blockedIds: Set<string>,
    ): void {
        let currentId = (parentId ?? '').trim();
        const visited = new Set<string>();
        let depth = 0;

        while (currentId && depth < 100) {
            if (blockedIds.has(currentId)) return;
            if (visited.has(currentId)) return;

            visited.add(currentId);
            output.add(currentId);

            const currentTask = this.indexer.getTask(currentId);
            currentId = (currentTask?.fieldValues['parentTask'] ?? '').trim();
            depth++;
        }
    }

    private async touchAncestorModifiedTimestamps(
        ancestorIds: Set<string>,
        timestamp: string,
    ): Promise<void> {
        const touchedFilePaths = new Set<string>();
        for (const ancestorId of ancestorIds) {
            const ancestorTask = this.indexer.getTask(ancestorId);
            if (ancestorTask) {
                ancestorTask.fieldValues['datetimeModified'] = timestamp;
            }
            await this.writeTaskFields(ancestorId, { datetimeModified: timestamp }, {
                reindex: 'none',
                touchAncestors: false,
            });
            if (ancestorTask) {
                touchedFilePaths.add(ancestorTask.primary.filePath);
            }
        }
        if (touchedFilePaths.size > 0) {
            await this.indexer.reindexFilesBatch(Array.from(touchedFilePaths), { notify: false });
        }
    }

    /**
     * Write field values to a YAML frontmatter task.
     * Uses a single processFrontMatter call for atomicity — field writes,
     * date clearing, and tag updates all happen in one pass.
     */
    private async writeYamlTask(
        file: TFile,
        operonId: string,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
        options: TaskWriteOptions,
    ): Promise<TaskWriteResult> {
        return await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
            let yamlFastPath: YamlFastPathState = 'none';
            let fallbackReason = 'none';
            if (options.yamlAggregateFastPath && mode === 'merge') {
                const content = await this.app.vault.read(file);
                const patchResult = tryPatchAggregateYamlFrontmatter(content, operonId, fieldValues, this.keyMappings);
                if (patchResult.ok) {
                    if (patchResult.content !== content) {
                        await this.app.vault.modify(file, patchResult.content);
                    }
                    return {
                        wrote: true,
                        yamlFastPath: 'aggregate',
                        fallbackReason: 'none',
                    };
                }
                yamlFastPath = 'fallback';
                fallbackReason = patchResult.fallbackReason;
            }
            let formattingPlan: YamlFrontmatterFormattingPlan = {
                blankYamlKeys: new Set<string>(),
                removedYamlKeys: new Set<string>(),
            };
            const nextFieldValues: Record<string, string> = { ...fieldValues };
            let wroteTask = false;

            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                if (!this.frontmatterMatchesOperonId(fm, operonId)) {
                    return;
                }
                wroteTask = true;
                if (!Object.prototype.hasOwnProperty.call(nextFieldValues, 'datetimeCreated')) {
                    const createdAliases = getManagedYamlAliases('datetimeCreated', this.keyMappings);
                    const hasExistingCreated = createdAliases.some((yamlKey) => {
                        const rawValue = fm[yamlKey];
                        const rawText = this.stringifyFrontmatterScalar(rawValue);
                        return rawText !== null && rawText.trim() !== '';
                    });
                    if (!hasExistingCreated) {
                        const createdFallback = resolveYamlTaskCreatedBackfillValue(file.stat.ctime);
                        if (createdFallback) {
                            nextFieldValues['datetimeCreated'] = createdFallback;
                        }
                    }
                }
                formattingPlan = applyYamlTaskFieldValues(fm, nextFieldValues, mode, this.keyMappings);
            });

            if (!wroteTask) {
                return { wrote: false, yamlFastPath, fallbackReason };
            }
            if (formattingPlan.blankYamlKeys.size > 0 || formattingPlan.removedYamlKeys.size > 0) {
                const content = await this.app.vault.read(file);
                const normalized = normalizeYamlFrontmatterFormatting(content, formattingPlan);
                if (normalized !== content) {
                    await this.app.vault.modify(file, normalized);
                }
            }
            return { wrote: true, yamlFastPath, fallbackReason };
        });
    }

    /**
     * Write field values to an inline task line.
     */
    private async writeInlineTask(
        file: TFile,
        operonId: string,
        fieldValues: Record<string, string>,
        lineHint: number,
        mode: 'merge' | 'replace',
    ): Promise<boolean> {
        return await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            const patch = tryPatchInlineTaskLineContent(
                content,
                file.path,
                operonId,
                fieldValues,
                lineHint,
                mode,
                this.keyMappings,
            );
            if (!patch.ok) return false;
            await this.app.vault.modify(file, patch.content);
            return true;
        });
    }

    private getFileWriteQueueKey(filePath: string): string {
        return `task-file:${filePath}`;
    }

    private blockDuplicateConflict(operonId: string): boolean {
        const indexer = this.indexer as OperonIndexer & {
            hasDuplicateOperonIdConflict?: (id: string) => boolean;
        };
        if (typeof indexer.hasDuplicateOperonIdConflict !== 'function') {
            return false;
        }
        if (!indexer.hasDuplicateOperonIdConflict(operonId)) {
            return false;
        }
        this.hooks.onDuplicateConflict?.(operonId);
        return true;
    }

    private frontmatterMatchesOperonId(frontmatter: Record<string, unknown>, operonId: string): boolean {
        const aliases = getManagedYamlAliases('operonId', this.keyMappings);
        for (const yamlKey of aliases) {
            const value = frontmatter[yamlKey];
            const rawText = this.stringifyFrontmatterScalar(value);
            if (rawText === null) continue;
            if (rawText.trim() === operonId) return true;
        }
        return false;
    }

    private buildReverseKeyMap(): Map<string, string> {
        const reverse = new Map<string, string>();
        for (const mapping of this.keyMappings) {
            if (!mapping.visiblePropertyName) continue;
            reverse.set(mapping.visiblePropertyName, mapping.canonicalKey);
        }
        return reverse;
    }
}
