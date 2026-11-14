import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pressable } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchableListSelector, type SearchableListSelectorProps, type SelectorConfig } from './SearchableListSelector';

type PressEvent = { stopPropagation: () => void };
type CapturedPressable = {
    accessibilityLabel?: string;
    onPress?: (event: PressEvent) => void;
    children?: React.ReactNode;
};

const captured = vi.hoisted(() => ({
    pressables: [] as CapturedPressable[],
    items: [] as Array<{ title: string; onPress?: () => void }>,
    inputs: [] as Array<{ value: string; onChangeText: (text: string) => void }>,
}));

vi.mock('react-native', async () => {
    const React = await import('react');
    return {
        View: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
        Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
        Pressable: (props: CapturedPressable) => {
            captured.pressables.push(props);
            return React.createElement('button', {
                'aria-label': props.accessibilityLabel,
                type: 'button',
            }, props.children);
        },
        Platform: {
            OS: 'web',
            select: (values: Record<string, unknown>) => values.web ?? values.default,
        },
    };
});

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            surface: '#fff',
            surfaceHigh: '#eee',
            divider: '#ddd',
            text: '#111',
            textSecondary: '#666',
            input: { background: '#fff' },
            button: { primary: { background: '#123', tint: '#fff' } },
        },
    };
    return {
        useUnistyles: () => ({ theme }),
        StyleSheet: { create: (factory: (value: typeof theme) => unknown) => factory(theme) },
    };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/StatusDot', () => ({ StatusDot: () => null }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({
    t: (key: string, params?: { count?: number }) => {
        if (key === 'common.delete') return 'Delete';
        if (key === 'machineLauncher.showAll') return `Show all (${params?.count})`;
        if (key === 'machineLauncher.showLess') return 'Show less';
        return key;
    },
}));

vi.mock('@/components/ItemGroup', async () => {
    const React = await import('react');
    return {
        ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('section', {
            'data-testid': 'list-group',
        }, children),
    };
});

vi.mock('@/components/Item', async () => {
    const React = await import('react');
    return {
        Item: (props: { title: string; onPress?: () => void; rightElement?: React.ReactNode }) => {
            captured.items.push(props);
            return React.createElement('div', { 'data-list-item': props.title }, props.title, props.rightElement);
        },
    };
});

vi.mock('@/components/MultiTextInput', async () => {
    const React = await import('react');
    return {
        MultiTextInput: (props: { value: string; onChangeText: (text: string) => void }) => {
            captured.inputs.push(props);
            return React.createElement('input', { value: props.value, readOnly: true });
        },
    };
});

const paths = Array.from({ length: 6 }, (_, index) => `/workspace/project-${index + 1}`);

function makeConfig(overrides: Partial<SelectorConfig<string>> = {}): SelectorConfig<string> {
    return {
        getItemId: path => path,
        getItemTitle: path => path.split('/').pop() || path,
        getItemIcon: () => null,
        formatForDisplay: path => path,
        parseFromDisplay: text => text.startsWith('/') ? text : null,
        filterItem: (path, searchText) => path.includes(searchText),
        searchPlaceholder: 'Working directory',
        recentSectionTitle: 'Recent directories',
        favoritesSectionTitle: 'Favorites',
        allSectionTitle: 'Subdirectories',
        noItemsMessage: 'No directories',
        showFavorites: false,
        showRecent: true,
        showSearch: true,
        allowCustomInput: true,
        ...overrides,
    };
}

function render(
    config: SelectorConfig<string>,
    overrides: Partial<Omit<SearchableListSelectorProps<string>, 'config'>> = {},
): string {
    return renderToStaticMarkup(React.createElement(SearchableListSelector<string>, {
        config,
        items: [],
        recentItems: paths,
        selectedItem: null,
        onSelect: vi.fn(),
        ...overrides,
    }));
}

function pressable(label: string): CapturedPressable {
    const item = captured.pressables.find(entry => entry.accessibilityLabel === label);
    expect(item, `Pressable with accessible label ${label}`).toBeDefined();
    return item!;
}

function textContent(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textContent).join('');
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
        return textContent(node.props.children);
    }
    return '';
}

function containsIcon(node: React.ReactNode, name: string): boolean {
    if (Array.isArray(node)) return node.some(child => containsIcon(child, name));
    if (React.isValidElement<{ name?: string; children?: React.ReactNode }>(node)) {
        return node.props.name === name || containsIcon(node.props.children, name);
    }
    return false;
}

function clearInputButton(): CapturedPressable {
    const item = captured.pressables.find(entry => containsIcon(entry.children, 'close'));
    expect(item, 'Input clear button').toBeDefined();
    return item!;
}

describe('SearchableListSelector compact options', () => {
    beforeEach(() => {
        captured.pressables.length = 0;
        captured.items.length = 0;
        captured.inputs.length = 0;
    });

    it('opts into three recent chips and offers access to the remaining recent directories', () => {
        const html = render(makeConfig({ recentItemsAsChips: true }));
        expect(captured.pressables.filter(entry => paths.some(path => path.endsWith(`/${entry.accessibilityLabel}`))))
            .toHaveLength(3);
        for (const path of paths.slice(0, 3)) {
            expect(pressable(path.split('/').pop()!).onPress).toBeTypeOf('function');
        }
        expect(html).toContain('Show all (6)');
        expect(html).not.toContain('project-4');
        expect(captured.items).toHaveLength(0);
    });

    it('keeps the legacy recent list, five-item limit and show-more control when chips are not enabled', () => {
        const html = render(makeConfig(), {
            collapsedSections: { recent: false, favorites: true, all: true },
            onCollapsedSectionsChange: vi.fn(),
        });
        expect(html).toContain('data-testid="list-group"');
        expect(captured.items.filter(item => item.title.startsWith('project-')).map(item => item.title))
            .toEqual(['project-1', 'project-2', 'project-3', 'project-4', 'project-5']);
        expect(captured.items.some(item => item.title === 'Show all (6)')).toBe(true);
        expect(captured.pressables.some(entry => entry.accessibilityLabel === 'project-1')).toBe(false);
    });

    it('preserves the legacy default collapsed recent section for other callers', () => {
        const html = render(makeConfig());
        expect(html).toContain('Recent directories');
        expect(captured.items).toHaveLength(0);
        expect(html).not.toContain('project-1');
    });

    it('selects a chip through the normal display-format and onSelect pipeline', () => {
        const formatForDisplay = vi.fn((path: string) => `display:${path}`);
        const onSelect = vi.fn();
        render(makeConfig({ recentItemsAsChips: true, formatForDisplay }), { onSelect });
        pressable('project-2').onPress!({ stopPropagation: vi.fn() });
        expect(formatForDisplay).toHaveBeenCalledWith(paths[1], undefined);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith(paths[1]);
    });

    it('removes a recent chip without also selecting its directory', () => {
        const onRemoveRecentItem = vi.fn();
        const onSelect = vi.fn();
        const event = { stopPropagation: vi.fn() };
        render(makeConfig({ recentItemsAsChips: true }), { onSelect, onRemoveRecentItem });
        pressable('Delete project-2').onPress!(event);
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(onRemoveRecentItem).toHaveBeenCalledExactlyOnceWith(paths[1]);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('passes a functional accessory through next to the existing search input', () => {
        const onBrowse = vi.fn();
        const onSelect = vi.fn();
        const accessory = React.createElement(Pressable, {
            onPress: onBrowse,
            accessibilityLabel: 'Browse directory',
        }, 'Browse');
        const html = render(makeConfig({ recentItemsAsChips: true, searchAccessory: accessory }), { onSelect });
        expect(html).toContain('aria-label="Browse directory"');
        expect(html.indexOf('Browse directory')).toBeGreaterThan(html.indexOf('<input'));
        pressable('Browse directory').onPress!({ stopPropagation: vi.fn() });
        expect(onBrowse).toHaveBeenCalledOnce();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('does not force a search accessory or recent chips into sections hidden by the caller', () => {
        const html = render(makeConfig({
            recentItemsAsChips: true,
            searchAccessory: React.createElement('span', null, 'Browse accessory'),
        }), { showSearch: false, showRecent: false });
        expect(html).not.toContain('Browse accessory');
        expect(html).not.toContain('Recent directories');
        expect(captured.inputs).toHaveLength(0);
        expect(captured.pressables).toHaveLength(0);
    });

    it('retains custom path parsing and the existing input observer with compact recent items', () => {
        const onInputTextChange = vi.fn();
        const onSelect = vi.fn();
        render(makeConfig({ recentItemsAsChips: true, onInputTextChange }), { onSelect });
        expect(captured.inputs).toHaveLength(1);
        captured.inputs[0].onChangeText('/workspace/manual');
        expect(onInputTextChange).toHaveBeenCalledExactlyOnceWith('/workspace/manual');
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('/workspace/manual');
    });

    it.each(['', '   '])('lets compact callers clear the effective selection for empty input %j', text => {
        let selected: string | null = paths[0];
        const onInputTextChange = vi.fn();
        const onSelect = vi.fn();
        const onEmptyInput = vi.fn(() => { selected = null; });
        render(makeConfig({ recentItemsAsChips: true, onInputTextChange, onEmptyInput }), {
            selectedItem: selected,
            onSelect,
        });

        captured.inputs[0].onChangeText(text);

        expect(onInputTextChange).toHaveBeenCalledExactlyOnceWith(text);
        expect(onEmptyInput).toHaveBeenCalledOnce();
        expect(selected).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('lets the compact clear button reset the effective directory through the opt-in callback', () => {
        let selected: string | null = paths[0];
        const onSelect = vi.fn();
        const onEmptyInput = vi.fn(() => { selected = null; });
        render(makeConfig({ recentItemsAsChips: true, onEmptyInput }), {
            selectedItem: selected,
            onSelect,
        });

        clearInputButton().onPress!({ stopPropagation: vi.fn() });

        expect(onEmptyInput).toHaveBeenCalledOnce();
        expect(selected).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it.each(['typing', 'button'])('keeps the selected item for legacy callers when clearing by %s', method => {
        let selected: string | null = paths[0];
        const onSelect = vi.fn((path: string) => { selected = path; });
        render(makeConfig(), { selectedItem: selected, onSelect });

        if (method === 'typing') captured.inputs[0].onChangeText('');
        else clearInputButton().onPress!({ stopPropagation: vi.fn() });

        expect(selected).toBe(paths[0]);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('supports repeatedly closing and reopening caller-controlled directory browsing', () => {
        let collapsed: NonNullable<SearchableListSelectorProps<string>['collapsedSections']> = {
            recent: true,
            favorites: true,
            all: false,
        };
        const onCollapsedSectionsChange = vi.fn((next: typeof collapsed) => { collapsed = next; });
        const renderControlled = () => {
            captured.pressables.length = 0;
            captured.items.length = 0;
            return render(makeConfig({ recentItemsAsChips: true }), {
                items: ['/workspace/current/src', '/workspace/current/docs'],
                recentItems: [],
                collapsedSections: collapsed,
                onCollapsedSectionsChange,
            });
        };
        const toggleDirectories = () => {
            const header = captured.pressables.find(entry => textContent(entry.children) === 'Subdirectories');
            expect(header).toBeDefined();
            header!.onPress!({ stopPropagation: vi.fn() });
        };

        for (let repeat = 0; repeat < 3; repeat += 1) {
            renderControlled();
            expect(captured.items.map(item => item.title)).toEqual(['src', 'docs']);

            toggleDirectories();
            expect(collapsed).toEqual({ recent: true, favorites: true, all: true });
            renderControlled();
            expect(captured.items).toHaveLength(0);

            toggleDirectories();
            expect(collapsed).toEqual({ recent: true, favorites: true, all: false });
        }
        expect(onCollapsedSectionsChange).toHaveBeenCalledTimes(6);
    });
});
