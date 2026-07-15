import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../ui/useToast";
import { cn } from "../lib/utils";
import CreateWorkspaceDialog from "../CreateWorkspaceDialog";
import { TeamsService } from "../../services/TeamsService";
import { syncService } from "../../services/SyncService.js";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAuth } from "../../hooks/useAuth";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { loadSpaces, revealContainer, setActiveContext } from "../../stores/noteStore";
import type { WorkspaceMember } from "../../types/electron";

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateSpaceDialog({ open, onOpenChange }: CreateSpaceDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { workspaces, active, loaded } = useWorkspace();
  const roster = useWorkspaceStore((s) => s.members);
  const refreshMembers = useWorkspaceStore((s) => s.refreshMembers);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const showSpinner = useDelayedFlag(isCreating);

  // Multiple workspaces with none active: default to the first the user can
  // create spaces in (owner/admin) — kept deliberately simple for v1.
  const workspace =
    active ?? workspaces.find((w) => w.role === "owner" || w.role === "admin") ?? null;
  const needsWorkspace = open && loaded && !workspace;

  useEffect(() => {
    if (open && workspace) void refreshMembers(workspace.id);
  }, [open, workspace, refreshMembers]);

  const candidates = useMemo(
    () => roster.filter((m) => m.user_id !== user?.id),
    [roster, user?.id]
  );
  const filteredCandidates = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (m) => (m.name ?? "").toLowerCase().includes(query) || m.email.toLowerCase().includes(query)
    );
  }, [candidates, memberSearch]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setName("");
      setEmoji("");
      setMemberSearch("");
      setSelectedIds(new Set());
    }
  };

  // Chained CreateWorkspaceDialog: closing after a successful create keeps the
  // flow alive (the space dialog renders once the store has the workspace);
  // cancelling closes everything.
  const handleWorkspaceDialogChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    const created = useWorkspaceStore
      .getState()
      .workspaces.some((w) => w.role === "owner" || w.role === "admin");
    if (!created) onOpenChange(false);
  };

  const toggleMember = (member: WorkspaceMember) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(member.user_id)) next.add(member.user_id);
      return next;
    });
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isCreating || !workspace) return;
    setIsCreating(true);
    try {
      const team = await TeamsService.create(workspace.id, {
        name: trimmed,
        emoji: emoji.trim() || null,
      });
      let added = 0;
      let memberError: string | null = null;
      for (const userId of selectedIds) {
        try {
          await TeamsService.addMember(team.id, userId);
          added += 1;
        } catch (err) {
          memberError = err instanceof Error ? err.message : t("common.unknownError");
        }
      }
      if (memberError) {
        toast({ title: t("common.error"), description: memberError, variant: "destructive" });
      }
      const space = await window.electronAPI.upsertSpaceFromCloud?.({
        ...team,
        my_role: "admin",
        member_count: added,
      });
      if (space) {
        await loadSpaces();
        revealContainer(space.id, null);
        setActiveContext(space.id, null);
      }
      syncService.requestSyncAll("manual");
      handleOpenChange(false);
    } catch (err) {
      toast({
        title: t("notes.spaces.couldNotCreate"),
        description: err instanceof Error ? err.message : t("common.unknownError"),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <CreateWorkspaceDialog open={needsWorkspace} onOpenChange={handleWorkspaceDialogChange} />

      <Dialog open={open && !needsWorkspace} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-95 p-6 gap-5">
          <DialogHeader>
            <DialogTitle>{t("notes.spaces.createTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex gap-3">
            <div className="space-y-1.5 w-14 shrink-0">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.spaces.emojiLabel")}
              </label>
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={4}
                className="text-center"
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.spaces.nameLabel")}
              </label>
              <Input
                value={name}
                autoFocus
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.spaces.members.addPeople")}
              </label>
              <div className="rounded border border-border/70 dark:border-border-subtle/50 overflow-hidden">
                <div className="relative border-b border-border/40 dark:border-border-subtle/40">
                  <Search
                    size={11}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/25 pointer-events-none"
                  />
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder={t("notes.spaces.members.searchPlaceholder")}
                    className="w-full h-8 pl-7 pr-2 bg-transparent text-xs text-foreground placeholder:text-foreground/25 outline-none"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto p-1">
                  {filteredCandidates.map((member) => {
                    const isSelected = selectedIds.has(member.user_id);
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleMember(member)}
                        className={cn(
                          "flex items-center gap-2 w-full px-2 h-8 rounded-md text-left",
                          "transition-colors duration-150 outline-none",
                          "hover:bg-foreground/4 dark:hover:bg-white/4",
                          "focus-visible:ring-1 focus-visible:ring-ring/30"
                        )}
                      >
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[9px] font-semibold flex items-center justify-center shrink-0">
                          {(member.name || member.email).slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-xs text-foreground truncate flex-1">
                          {member.name || member.email}
                        </span>
                        {isSelected && <Check size={11} className="text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {filteredCandidates.length === 0 && (
                    <p className="text-xs text-foreground/25 text-center py-2">
                      {t("notes.context.noResults")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isCreating}>
              {t("notes.upload.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || isCreating || !workspace}>
              {showSpinner && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("notes.spaces.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
