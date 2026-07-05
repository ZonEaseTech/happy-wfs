import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(__dirname, "../app/(app)/bug/index.tsx");
const webEditorPath = resolve(__dirname, "./BugTiptapEditor.web.tsx");

describe("bug board desktop layout", () => {
  it("uses the confirmed V9 desktop two-column sizing", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("maxWidth: 1680");
    expect(source).toContain("gap: 28");
    expect(source).toContain("width: 520");
    expect(source).toContain("minWidth: 520");
    expect(source).toContain("maxWidth: 520");
    expect(source).toContain("flexBasis: 520");
    expect(source).toContain("flexGrow: 0");
  });

  it("keeps the desktop left rail as a fixed flex item instead of a growing ScrollView", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("<View style={styles.leftPanel}>");
    expect(source).toContain("style={styles.leftPanelScroll}");
    expect(source).not.toContain("style={styles.leftPanel}\n              contentContainerStyle={styles.leftPanelContent}");
    expect(source).toContain("leftPanelScroll");
  });

  it("keeps the desktop columns visually balanced and removes duplicated title counts", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('alignItems: "stretch"');
    expect(source).toContain('alignSelf: "stretch"');
    expect(source).not.toContain("{filteredBugs.length}{\" \"}");
    expect(source).not.toContain("{counts[currentFilter]}");
  });

  it("uses a compact desktop detail title area", () => {
    const source = readFileSync(sourcePath, "utf8");

    const detailHeaderBlock = source.match(/detailHeader:\s*\{[\s\S]*?\n  \},/)?.[0];

    expect(detailHeaderBlock).not.toContain("minHeight");
    expect(detailHeaderBlock).toContain("paddingVertical: 14");
    expect(source).not.toContain("minHeight: 150");
    expect(source).not.toContain("paddingVertical: 26");
  });

  it("removes duplicate board-card actions and detail filter subtitle on desktop", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("showActions={!isWide}");
    expect(source).toContain("{showActions && (");

    const detailHeaderMatch = source.match(
      /<View style=\{styles\.detailHeader\}>[\s\S]*?<View style=\{styles\.detailHeaderActions\}>/,
    )?.[0];

    expect(detailHeaderMatch).not.toContain('t("bug.selectedInFilter")');
    expect(detailHeaderMatch).not.toContain("bug.createdByNickname");
  });

  it("keeps bug-card status and counts on the right side instead of below the title", () => {
    const source = readFileSync(sourcePath, "utf8");
    const listItemMatch = source.match(
      /function PublicBugListItem[\s\S]*?<\/Pressable>\n\s*\);/,
    )?.[0];

    expect(listItemMatch).toContain("styles.bugItemRight");
    expect(listItemMatch!.indexOf("styles.bugItemContent")).toBeLessThan(
      listItemMatch!.indexOf("styles.bugItemRight"),
    );
    expect(listItemMatch!.indexOf("styles.bugItemRight")).toBeLessThan(
      listItemMatch!.indexOf('name="chevron-forward"'),
    );

    const contentBlock = listItemMatch?.match(
      /<View style=\{styles\.bugItemContent\}>[\s\S]*?<\/View>\n\s*<View style=\{styles\.bugItemRight\}>/,
    )?.[0];

    expect(contentBlock).not.toContain("styles.bugMetaRow");
  });

  it("prevents browser-level scrolling on the desktop board", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('height: "100vh" as unknown as number');
    expect(source).toContain('overflow: "hidden"');
    expect(source).not.toContain("calc(100vh - 132px)");
  });

  it("always renders the right detail pane on desktop, even when there are no bugs", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain(
      "const isDesktopEmpty = filteredBugs.length === 0",
    );
    expect(source).not.toContain("styles.desktopEmptyShell");
    expect(source).not.toContain("styles.desktopEmptyPanel");
    expect(source).toContain("styles.detailPanel");
    expect(source).toContain("<PublicBugDetailPane");
    expect(source).toContain(
      "<BugBoardEmpty query={query} loading={board.loading} />",
    );
  });

  it("keeps filters horizontal while disabling RN Web content flex grow", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('useWebHorizontalScroll({ wheelBehavior: "always" })');
    expect(source).toContain("<View {...filterWheelProps}>");
    expect(source).toContain("{...filterScrollViewProps}");
    expect(source).toContain("<ScrollView");
    expect(source).toContain("horizontal");
    expect(source).toContain("styles.filterScroll");
    expect(source).toContain("styles.filterWrap");
    const filterWrapBlock = source.match(/filterWrap:\s*\{[\s\S]*?\n  \},/);
    expect(filterWrapBlock?.[0]).toContain("flexGrow: 0");
    expect(filterWrapBlock?.[0]).not.toContain('flexWrap: "wrap"');
    expect(source).toContain(
      '"all",\n    "open",\n    "pending",\n    "in_progress",\n    "verify",\n    "closed"',
    );
    expect(source).not.toContain("<StatusStat");
    expect(source).not.toContain("styles.statGrid");
    expect(source).not.toContain("styles.filterNote");
  });

  it("renders bug detail as one rich content field and a lightweight bottom status footer", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("styles.descriptionBox");
    expect(source).toContain("<BugRichContentView");
    expect(source).toContain("description={bug.description}");
    expect(source).toContain("attachments={bug.attachments}");
    expect(source).not.toContain("styles.detailSide");
    expect(source).not.toContain("styles.statusActionRow");
    expect(source).not.toContain("styles.historyList");
    expect(source).toContain(
      "const latestStatusEntry = bug.statusHistory.at(-1)",
    );
    expect(source).toContain("styles.detailContentColumns");
    expect(source).toContain("styles.detailCommentRail");
    expect(source).toContain("styles.detailCommentScroll");
    expect(source).toContain("styles.statusFooter");
    expect(source).toContain("styles.statusFooterCurrent");
    expect(source).toContain("formatBugStatusHistoryAction(latestStatusEntry)");
    expect(source).toContain("<ActionMenuModal");
  });

  it("keeps desktop bug content directly editable with a dirty-state save action", () => {
    const source = readFileSync(sourcePath, "utf8");
    const headerActions = source.match(
      /<View style=\{styles\.detailHeaderActions\}>[\s\S]*?<\/View>\n\s*<\/View>\n\n\s*<View style=\{styles\.detailBody\}>/,
    )?.[0];

    expect(headerActions).toContain('t("bug.changeStatus")');
    expect(headerActions).toContain('t("common.save")');
    expect(headerActions).toContain('t("bug.addComment")');
    expect(headerActions!.indexOf('t("bug.changeStatus")')).toBeLessThan(
      headerActions!.indexOf('t("common.save")'),
    );
    expect(headerActions!.indexOf('t("common.save")')).toBeLessThan(
      headerActions!.indexOf('t("bug.addComment")'),
    );
    expect(source).toContain("const [contentDirty, setContentDirty]");
    expect(source).toContain("const contentBaselineRef = React.useRef<string | null>(null)");
    expect(source).toContain("const handleContentSnapshotChange = React.useCallback");
    expect(source).toContain("disabled={!canSaveContent}");
    expect(source).toContain("contentDirty && styles.detailHeaderButtonPrimary");
    expect(source).toContain("<BugTiptapEditor");
    expect(source).not.toContain("contentEditing");
    expect(source).not.toContain('t("bug.editContent")');
    expect(source).not.toContain("styles.contentEditToolbar");
    expect(source).not.toContain(
      '<Text style={styles.sectionTitle}>{t("bug.description")}</Text>',
    );
    expect(source).not.toContain("styles.sectionHeaderRow");
  });

  it("keeps desktop bug description flush outside with square border and padded editor content", () => {
    const source = readFileSync(sourcePath, "utf8");
    const webEditorSource = readFileSync(webEditorPath, "utf8");
    const detailMainContentBlock = source.match(/detailMainContent:\s*\{[\s\S]*?\n  \},/)?.[0];
    const descriptionBoxBlock = source.match(/descriptionBox:\s*\{[\s\S]*?\n  \},/)?.[0];
    const detailCommentContentBlock = source.match(/detailCommentContent:\s*\{[\s\S]*?\n  \},/)?.[0];
    const commentCardBlock = source.match(/commentCard:\s*\{[\s\S]*?\n  \},/)?.[0];
    const commentInputBlock = source.match(/commentInput:\s*\{[\s\S]*?\n  \},/)?.[0];
    const detailEditorCssBlock = webEditorSource.match(
      /\.happy-bug-tiptap-editor\.detail \.tiptap \{[\s\S]*?\}/,
    )?.[0];

    expect(source).toContain("<View style={styles.detailContentColumns}>");
    expect(source).toContain("<View style={styles.detailCommentRail}>");
    expect(source).toContain("style={styles.detailCommentScroll}");
    expect(source).toContain("contentContainerStyle={styles.detailCommentContent}");
    expect(detailMainContentBlock).not.toContain("padding: 30");
    expect(descriptionBoxBlock).toContain('backgroundColor: "#FFFFFF"');
    expect(descriptionBoxBlock).toContain("borderWidth: 0");
    expect(descriptionBoxBlock).toContain("padding: 0");
    expect(descriptionBoxBlock).not.toContain("padding: 20");
    expect(descriptionBoxBlock).not.toContain("borderRadius");
    expect(detailEditorCssBlock).toContain("padding: 30px");
    expect(detailEditorCssBlock).toContain("box-sizing: border-box");
    expect(detailCommentContentBlock).toContain("paddingHorizontal: 24");
    expect(detailCommentContentBlock).toContain("paddingBottom: 24");
    expect(commentCardBlock).toContain("padding: 16");
    expect(commentInputBlock).toContain("padding: 14");
  });
});
