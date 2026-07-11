"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyFactory, renameFactory, type SavedFactory } from "@/lib/factory-storage";

interface RenameFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factory: SavedFactory;
  onRenamed?: (factory: SavedFactory) => void;
}

export function RenameFactoryDialog({
  open,
  onOpenChange,
  factory,
  onRenamed,
}: RenameFactoryDialogProps) {
  const [name, setName] = useState(factory.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(factory.name);
  }, [open, factory.name]);

  const handleRename = useCallback(() => {
    setSaving(true);
    setError(null);
    const updated = renameFactory(factory.id, name);
    setSaving(false);
    if (!updated) {
      setError("Could not save — enter a name and try again");
      return;
    }
    onRenamed?.(updated);
    onOpenChange(false);
  }, [factory.id, name, onOpenChange, onRenamed]);

  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-background/70 p-4 backdrop-blur-sm"
      aria-labelledby="rename-factory-title"
    >
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl ring-1 ring-foreground/10">
        <h2 id="rename-factory-title" className="font-heading text-lg font-semibold">
          Rename factory
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="factory-name">Factory name</Label>
          <Input
            id="factory-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleRename} disabled={saving}>
            {saving ? "Saving…" : "Save name"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

interface CopyFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceFactory: SavedFactory;
}

export function CopyFactoryDialog({ open, onOpenChange, sourceFactory }: CopyFactoryDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(`${sourceFactory.name} (copy)`);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(`${sourceFactory.name} (copy)`);
  }, [open, sourceFactory.name]);

  const handleCopy = useCallback(() => {
    setSaving(true);
    setError(null);
    const copy = copyFactory(sourceFactory, name);
    setSaving(false);
    if (!copy) {
      setError("Could not save — localStorage may be full");
      return;
    }
    onOpenChange(false);
    router.push(`/factory?id=${copy.id}`);
  }, [name, onOpenChange, router, sourceFactory]);

  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-background/70 p-4 backdrop-blur-sm"
      aria-labelledby="copy-factory-title"
    >
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl ring-1 ring-foreground/10">
        <h2 id="copy-factory-title" className="font-heading text-lg font-semibold">
          Save a copy
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a duplicate of this plan with a new name.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="copy-factory-name">Factory name</Label>
          <Input
            id="copy-factory-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCopy()}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={saving}>
            {saving ? "Saving…" : "Save copy"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
