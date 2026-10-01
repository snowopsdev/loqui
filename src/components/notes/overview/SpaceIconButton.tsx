import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateSpaceMeta } from "../../../stores/noteStore";
import type { SpaceItem } from "../../../types/electron";
import { EmojiPickerContent } from "../../ui/EmojiPicker";
import { Popover, PopoverTrigger } from "../../ui/popover";
import { useToast } from "../../ui/useToast";
import { ContainerIcon } from "./ContainerIcon";

interface SpaceIconButtonProps {
  space: SpaceItem;
  size?: number;
}

// The space's icon tile; opens the emoji picker to change it. The name of the
// Personal space is fixed, but its emoji is free to customize.
export function SpaceIconButton({ space, size = 20 }: SpaceIconButtonProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const changeEmoji = async (emoji: string | null) => {
    setOpen(false);
    try {
      const result = await updateSpaceMeta(space.id, { emoji });
      if (!result.success) throw new Error(result.error);
    } catch (error) {
      toast({
        title: t("notes.spaces.couldNotChangeEmoji"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("notes.spaces.changeEmoji")}
          title={t("notes.spaces.changeEmoji")}
          className="flex size-full items-center justify-center rounded-xl outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/20 data-[state=open]:bg-foreground/5 dark:hover:bg-white/8 dark:data-[state=open]:bg-white/8"
        >
          <ContainerIcon space={space} folder={null} size={size} />
        </button>
      </PopoverTrigger>
      <EmojiPickerContent value={space.emoji} onSelect={(emoji) => void changeEmoji(emoji)} />
    </Popover>
  );
}
