export const SHARING_DIALOG_DESKTOP_BREAKPOINT = 768;

export function shouldUseCenteredSharingDialog(platform: string, width: number): boolean {
    return platform === 'web' && width >= SHARING_DIALOG_DESKTOP_BREAKPOINT;
}
