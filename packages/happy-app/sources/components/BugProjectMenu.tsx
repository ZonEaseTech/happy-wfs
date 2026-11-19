import * as React from 'react';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Modal } from '@/modal';
import { t } from '@/text';

/**
 * Picks the project a bug belongs to: one already on the board, no project,
 * or a new name typed in. `projects` are the named projects on the board.
 */
export function BugProjectMenu({
    visible,
    projects,
    current,
    onSelect,
    onClose,
}: {
    visible: boolean;
    projects: string[];
    current: string | null;
    onSelect: (project: string | null) => void;
    onClose: () => void;
}) {
    const items = React.useMemo<ActionMenuItem[]>(() => [
        ...projects.map((name) => ({
            label: name,
            selected: current === name,
            onPress: () => onSelect(name),
        })),
        {
            label: t('bug.noProject'),
            secondary: true,
            selected: current === null,
            onPress: () => onSelect(null),
        },
        {
            label: t('bug.newProject'),
            onPress: () => {
                void Modal.prompt(t('bug.newProjectPrompt')).then((name) => {
                    const trimmed = name?.replace(/\s+/g, ' ').trim();
                    if (trimmed) onSelect(trimmed);
                });
            },
        },
    ], [current, onSelect, projects]);

    return (
        <ActionMenuModal
            visible={visible}
            title={t('bug.project')}
            items={items}
            onClose={onClose}
            deferItemPress
        />
    );
}
