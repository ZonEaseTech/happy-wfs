export function filterActionMenuItems<T extends { label: string }>(items: T[], query: string): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter(item => item.label.toLowerCase().includes(normalizedQuery));
}
