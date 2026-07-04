import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(__dirname, "../app/(app)/bug/index.tsx");

describe("bug board desktop layout", () => {
  it("uses the confirmed V9 desktop two-column sizing", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("maxWidth: 1480");
    expect(source).toContain("gap: 28");
    expect(source).toContain("width: 520");
    expect(source).toContain("minWidth: 520");
    expect(source).toContain("maxWidth: 520");
    expect(source).toContain("flexBasis: 520");
    expect(source).toContain("flexGrow: 0");
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

  it("wraps filter chips so every status remains visible in the fixed left rail", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("styles.filterWrap");
    expect(source).toContain('flexWrap: "wrap"');
    expect(source).not.toContain("styles.filterScroll");
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
    expect(source).toContain("styles.statusFooter");
    expect(source).toContain("styles.statusFooterCurrent");
    expect(source).toContain("formatBugStatusHistoryAction(latestStatusEntry)");
    expect(source).toContain("<ActionMenuModal");
  });
});
