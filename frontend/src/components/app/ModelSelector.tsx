import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { AvailableModel } from '@/data/types';

interface ModelSelectorProps {
  models: AvailableModel[];
  value: string | null;
  onChange: (id: string) => void;
  /** The user's default model, marked "(default)". Falls back to the admin default. */
  defaultModelId?: string | null;
  label?: string;
  id?: string;
  disabled?: boolean;
}

/**
 * Model picker grouped "Platform models" / "My models". BYOM entries will land in
 * "My models" (model_group = 'mine') without changes here.
 */
export function ModelSelector({ models, value, onChange, defaultModelId, label = 'AI model', id = 'model-selector', disabled }: ModelSelectorProps) {
  const platform = models.filter((m) => m.model_group === 'platform');
  const mine = models.filter((m) => m.model_group === 'mine');
  const markDefault = defaultModelId ?? models.find((m) => m.is_default)?.id;
  const selected = models.find((m) => m.id === value);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} aria-describedby={`${id}-description`}>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Platform models</SelectLabel>
            {platform.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name}
                {m.id === markDefault ? ' (default)' : ''}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>My models</SelectLabel>
            {mine.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name}
              </SelectItem>
            ))}
            {mine.length === 0 && (
              <SelectItem value="__byom_coming_soon" disabled>
                Coming soon: bring your own model
              </SelectItem>
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p id={`${id}-description`} className="text-sm text-muted-foreground">
        {selected?.description || 'Every search in this wishlist uses this model.'}
      </p>
    </div>
  );
}
