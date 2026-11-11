import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WishlistInput } from '@/data/queries';
import type { AvailableModel, Wishlist } from '@/data/types';
import { ModelSelector } from './ModelSelector';

interface WishlistFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wishlist?: Wishlist | null;
  models: AvailableModel[];
  /** User's default model, pre-selected for new wishlists. */
  defaultModelId: string | null;
  defaults: { currency: string; country: string | null };
  busy?: boolean;
  onSubmit: (input: WishlistInput) => void;
}

export function WishlistFormDialog({ open, onOpenChange, wishlist, models, defaultModelId, defaults, busy, onSubmit }: WishlistFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fallbackModel = defaultModelId && models.some((m) => m.id === defaultModelId) ? defaultModelId : models.find((m) => m.is_default)?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setName(wishlist?.name ?? '');
    setDescription(wishlist?.description ?? '');
    setModelId(wishlist ? wishlist.model_id ?? fallbackModel : fallbackModel);
    setError(null);
  }, [open, wishlist, fallbackModel]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the wishlist a name.');
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      model_id: modelId,
      ...(wishlist ? {} : { default_currency: defaults.currency, ship_to_country: defaults.country }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{wishlist ? 'Edit wishlist' : 'New wishlist'}</DialogTitle>
            <DialogDescription>
              {wishlist ? 'Model changes apply to future searches only.' : 'Group items you are shopping for, and pick the AI model that searches for them.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wishlist-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input id="wishlist-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home office" maxLength={120} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wishlist-description">Description</Label>
            <Textarea id="wishlist-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <ModelSelector models={models} value={modelId} onChange={setModelId} defaultModelId={fallbackModel} id="wishlist-model" />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {wishlist ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
