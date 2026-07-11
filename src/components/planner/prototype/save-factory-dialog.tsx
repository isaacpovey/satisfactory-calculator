"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFactoryId, saveFactory, type SavedFactory } from "@/lib/factory-storage";

interface SaveFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceFactory: SavedFactory;
  defaultName?: string;
}

export function SaveFactoryDialog({
  open,
  onOpenChange,
  sourceFactory,
  defaultName,
}: SaveFactoryDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(defaultName ?? `${sourceFactory.name} (copy)`);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a factory name");
      return;
    }
    setSaving(true);
    setError(null);
    const id = createFactoryId();
    const ok = saveFactory({
      id,
      name: trimmed,
      createdAt: new Date().toISOString(),
      plannerInput: sourceFactory.plannerInput,
      result: sourceFactory.result,
      builtSections: [...sourceFactory.builtSections],
    });
    setSaving(false);
    if (!ok) {
      setError("Could not save — localStorage may be full");
      return;
    }
    onOpenChange(false);
    router.push(`/prototype/factory/${id}/summary`);
  }, [name, onOpenChange, router, sourceFactory]);

  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-background/70 p-4 backdrop-blur-sm"
      aria-labelledby="save-factory-title"
    >
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl ring-1 ring-foreground/10">
        <h2 id="save-factory-title" className="font-heading text-lg font-semibold">
          Save as factory
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store this plan in your browser so you can return without recomputing.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="factory-name">Factory name</Label>
          <Input
            id="factory-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save factory"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
