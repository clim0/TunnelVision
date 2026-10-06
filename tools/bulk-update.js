/**
 * TunnelVision_BulkUpdate Tool
 * Allows the model to edit several existing lorebook entries in a single call —
 * e.g. updating multiple character trackers after one scene — instead of making
 * one TunnelVision_Update call per entry.
 */

import { getSettings } from '../tree-store.js';
import { batchUpdateEntries } from '../entry-manager.js';
import { getWritableBooks, resolveTargetBook, getBookListWithDescriptions } from '../tool-registry.js';
import { getLanguageInstruction } from '../agent-utils.js';
import { SECRET_AUTHORING_INSTRUCTION } from '../shared-utils.js';

export const TOOL_NAME = 'TunnelVision_BulkUpdate';
export const COMPACT_DESCRIPTION = 'Update multiple existing lorebook entries in one call — more efficient than several TunnelVision_Update calls.';

/**
 * Returns the tool definition for ToolManager.registerFunctionTool().
 * @returns {Object}
 */
export function getDefinition() {
    const bookDesc = getBookListWithDescriptions({ writableOnly: true });

    return {
        name: TOOL_NAME,
        displayName: 'TunnelVision Bulk Update',
        description: `Update several existing memory entries in a single call. Use this instead of multiple TunnelVision_Update calls when more than one entry needs to change at once (e.g. several character trackers after one scene).

Each entry in "entries" follows the same rules as TunnelVision_Update: provide either "content" (full replacement) or "find"/"replace" (surgical edit) for text changes, plus optional "title", "keys", and "note".

You must know each entry's UID (obtained from a previous TunnelVision_Search retrieve action) and which lorebook it belongs to.

Available lorebooks:
${bookDesc}`,
        parameters: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    description: 'Array of entries to update in one call.',
                    items: {
                        type: 'object',
                        properties: {
                            lorebook: {
                                type: 'string',
                                description: `Which lorebook this entry belongs to. Choose based on where the entry lives:\n${bookDesc}`,
                            },
                            uid: {
                                type: 'number',
                                description: 'The UID of the entry to update.',
                            },
                            content: {
                                type: 'string',
                                description: `New content to replace the existing entry content. Write the complete updated version. For a small surgical edit, use "find"/"replace" instead.${SECRET_AUTHORING_INSTRUCTION}${getLanguageInstruction()}`,
                            },
                            find: {
                                type: 'string',
                                description: 'Exact substring to locate in the entry\'s current content, for a surgical edit instead of resending the whole entry. Use together with "replace". Do not combine with "content".',
                            },
                            replace: {
                                type: 'string',
                                description: 'Text to replace the matched "find" substring with. Required when "find" is used — pass an empty string to delete the matched text.',
                            },
                            replaceAll: {
                                type: 'boolean',
                                description: 'When using "find"/"replace": if true, replace every occurrence; otherwise only the first occurrence (default).',
                            },
                            title: {
                                type: 'string',
                                description: 'Optional new title/comment for the entry.',
                            },
                            keys: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Optional new keywords to replace existing ones.',
                            },
                            note: {
                                type: 'string',
                                description: 'Optional short note explaining why this entry changed. Shown in its version history.',
                            },
                        },
                        required: ['uid'],
                    },
                },
            },
            required: ['entries'],
        },
        action: async (args) => {
            if (!Array.isArray(args?.entries) || args.entries.length === 0) {
                return 'Missing required field: entries must be a non-empty array.';
            }

            // Resolve each entry's target lorebook and validate its content/find shape,
            // grouping by book so each book gets exactly one load/save cycle.
            const byBook = new Map();
            const earlyErrors = [];

            for (const item of args.entries) {
                if (item?.uid === undefined || item?.uid === null) {
                    earlyErrors.push({ uid: undefined, error: 'Missing required field: uid is required for each entry.' });
                    continue;
                }

                const { book: lorebook, error } = resolveTargetBook(item.lorebook, { checkWrite: true });
                if (error) {
                    earlyErrors.push({ uid: item.uid, error });
                    continue;
                }

                if (item.content && item.find !== undefined) {
                    earlyErrors.push({ uid: item.uid, error: 'Provide either "content" or "find"/"replace", not both.' });
                    continue;
                }
                if (item.find !== undefined && item.replace === undefined) {
                    earlyErrors.push({ uid: item.uid, error: 'Provide "replace" when using "find" (use an empty string to delete the matched text).' });
                    continue;
                }
                if (!item.content && item.find === undefined && !item.title && !item.keys) {
                    earlyErrors.push({ uid: item.uid, error: 'Nothing to update. Provide at least one of: content, find/replace, title, or keys.' });
                    continue;
                }

                const updates = { uid: Number(item.uid) };
                if (item.find !== undefined) {
                    updates.find = item.find;
                    updates.replace = item.replace;
                    updates.replaceAll = !!item.replaceAll;
                } else if (item.content) {
                    updates.content = item.content;
                }
                if (item.title) updates.title = item.title;
                if (item.keys) updates.keys = item.keys;
                if (item.note) updates.note = item.note;

                if (!byBook.has(lorebook)) byBook.set(lorebook, []);
                byBook.get(lorebook).push(updates);
            }

            const allResults = [...earlyErrors];
            for (const [book, updatesList] of byBook) {
                try {
                    const { results } = await batchUpdateEntries(book, updatesList);
                    for (const r of results) allResults.push({ ...r, lorebook: book });
                } catch (e) {
                    console.error(`[TunnelVision] Bulk update failed for lorebook "${book}":`, e);
                    for (const u of updatesList) allResults.push({ uid: u.uid, lorebook: book, error: e.message });
                }
            }

            const succeeded = allResults.filter(r => !r.error);
            const failed = allResults.filter(r => r.error);

            let response = `Updated ${succeeded.length}/${allResults.length} entr${allResults.length === 1 ? 'y' : 'ies'}`;
            if (byBook.size > 1) response += ` across ${byBook.size} lorebook(s)`;
            response += '.';
            if (succeeded.length > 0) {
                response += `\nSucceeded: ${succeeded.map(r => `UID ${r.uid} (${(r.updated || []).join(', ')})`).join('; ')}.`;
            }
            if (failed.length > 0) {
                response += `\nFailed: ${failed.map(r => `UID ${r.uid ?? '?'} — ${r.error}`).join('; ')}.`;
            }
            return response;
        },
        formatMessage: async () => 'Updating multiple memory entries...',
        shouldRegister: async () => {
            const settings = getSettings();
            if (settings.globalEnabled === false) return false;
            return getWritableBooks().length > 0;
        },
        stealth: false,
    };
}
