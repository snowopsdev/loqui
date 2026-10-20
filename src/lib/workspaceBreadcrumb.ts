import type { ControlPanelView } from "../components/controlPanelNav";

export function buildWorkspaceBreadcrumb(input: {
  view: ControlPanelView;
  viewLabel: string;
  folderName?: string | null;
  noteTitle?: string | null;
}): string[] {
  const crumbs = [input.viewLabel];
  if (input.view === "personal-notes") {
    const folder = input.folderName?.trim();
    const note = input.noteTitle?.trim();
    if (folder) crumbs.push(folder);
    if (note) crumbs.push(note);
  }
  return crumbs.filter(Boolean);
}
