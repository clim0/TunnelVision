/**
 * TunnelVision_Update Tool
 * Allows the model to edit existing lorebook entries mid-generation.
 * Use when information changes — character status, relationship evolution,
 * location changes, correcting outdated facts.
 */

import { getSettings } from '../tree-store.js';
import { updateEntry } from '../entry-manager.js';
import { getWritableBooks, resolveTargetBook, getBookListWithDescriptions } from '../tool-registry.js';
import { getLanguageInstruction } from '../agent-utils.js';
import { SECRET_AUTHORING_INSTRUCTION } from '../shared-utils.js';

export const TOOL_NAME = 'TunnelVision_Update';
export const COMPACT_DESCRIPTION = 'Modify an existing lorebook entry — update content, title, or keys when stored information changes.';

/**
 * Returns the tool definition for ToolManager.registerFunctionTool().
 * @returns {Object}
 */
export function getDefinition() {
    const bookDesc = getBookListWithDescriptions({ writableOnly: true });

    return {
        name: TOOL_NAME,
        displayName: 'TunnelVision Update',
        description: `Update an existing memory entry when information has changed. Use this when a character's status changes, a relationship evolves, a location is altered, or any previously stored fact becomes outdated.

This is especially important for TRACKER entries — structured entries that track character moods, inventory, relationships, positions, stats, etc. When updating a tracker, preserve its schema format (headers, key:value pairs, structure) and only change the values that actually changed. Do not rewrite the entire tracker unless the schema itself needs revision.

You must know the entry's UID (obtained from a previous TunnelVision_Search retrieve action) and which lorebook it belongs to.

Available lorebooks:
${bookDesc}`,
        parameters: {
            type: 'object',
            properties: {
                lorebook: {
                    type: 'string',
                    description: `Which lorebook the entry belongs to. Choose based on where the entry lives:\n${bookDesc}`,
                },
                uid: {
                    type: 'number',
                    description: 'The UID of the entry to update (from a previous search/retrieve result).',
                },
                content: {
                    type: 'string',
                    description: `New content to replace the existing entry content. Write the complete updated version. For a small surgical edit (e.g. changing one fact without rewriting the whole entry), use "find"/"replace" instead of this.${SECRET_AUTHORING_INSTRUCTION}${getLanguageInstruction()}`,
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
                    description: 'Optional short note explaining why this change was made (e.g. "status changed after the battle"). Shown in the entry\'s version history.',
                },
            },
            required: ['lorebook', 'uid'],
        },
        action: async (args) => {
            if (args?.uid === undefined || args?.uid === null) {
                return 'Missing required field: uid is required.';
            }

            const { book: lorebook, error } = resolveTargetBook(args.lorebook, { checkWrite: true });
            if (error) return error;

            if (args.content && args.find !== undefined) {
                return 'Provide either "content" (full replacement) or "find"/"replace" (surgical edit), not both.';
            }
            if (args.find !== undefined && args.replace === undefined) {
                return 'Provide "replace" when using "find" (use an empty string to delete the matched text).';
            }

            // Must provide at least one thing to update
            if (!args.content && args.find === undefined && !args.title && !args.keys) {
                return 'Nothing to update. Provide at least one of: content, find/replace, title, or keys.';
            }

            try {
                const updates = {};
                if (args.find !== undefined) {
                    updates.find = args.find;
                    updates.replace = args.replace;
                    updates.replaceAll = !!args.replaceAll;
                } else if (args.content) {
                    updates.content = args.content;
                }
                if (args.title) updates.comment = args.title;
                if (args.keys) updates.keys = args.keys;
                if (args.note) updates.note = args.note;
                if (args._backgroundSource) updates._backgroundSource = args._backgroundSource;

                const result = await updateEntry(lorebook, Number(args.uid), updates);
                return `Updated entry "${result.comment}" (UID ${result.uid}): changed ${result.updated.join(', ')}.`;
            } catch (e) {
                console.error('[TunnelVision] Update failed:', e);
                return `Failed to update entry: ${e.message}`;
            }
        },
        formatMessage: async () => 'Updating memory entry...',
        shouldRegister: async () => {
            const settings = getSettings();
            if (settings.globalEnabled === false) return false;
            return getWritableBooks().length > 0;
        },
        stealth: false,
    };
}
