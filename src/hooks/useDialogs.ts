import { useState, useCallback } from "react";

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  variant?: "default" | "destructive";
  confirmText?: string;
  cancelText?: string;
}

export interface AlertDialogState {
  open: boolean;
  title: string;
  description?: string;
}

const noop = () => {};

const defaultConfirmDialog: ConfirmDialogState = {
  open: false,
  title: "",
  onConfirm: noop,
};

const defaultAlertDialog: AlertDialogState = {
  open: false,
  title: "",
};

// Custom hook for managing dialog states
export function useDialogs() {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(defaultConfirmDialog);
  const [alertDialog, setAlertDialog] = useState<AlertDialogState>(defaultAlertDialog);

  const showConfirmDialog = useCallback((options: Omit<ConfirmDialogState, "open">) => {
    setConfirmDialog({ ...options, open: true });
  }, []);

  const showAlertDialog = useCallback((options: Omit<AlertDialogState, "open">) => {
    setAlertDialog({ ...options, open: true });
  }, []);

  // Closing keeps the copy so it does not blank out during the Radix exit
  // animation; the confirm action is dropped so a late click cannot re-fire it.
  const hideConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: noop }));
  }, []);

  const hideAlertDialog = useCallback(() => {
    setAlertDialog((prev) => ({ ...prev, open: false }));
  }, []);

  return {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
    setAlertDialog,
  };
}
