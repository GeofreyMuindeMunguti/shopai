import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface OnboardingStep {
  title: string;
  description?: string;
  optional?: boolean;
}

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  current: number;
  children: ReactNode;
  canContinue: boolean;
  busy?: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip?: () => void;
  finishLabel?: string;
}

/** Wizard shell: numbered step list, one step's content, Back / Continue footer. */
export function OnboardingStepper({ steps, current, children, canContinue, busy, onBack, onNext, onSkip, finishLabel = 'Finish' }: OnboardingStepperProps) {
  const step = steps[current];
  const isLast = current === steps.length - 1;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <nav aria-label="Setup progress">
        <ol className="flex flex-wrap gap-2">
          {steps.map((s, i) => (
            <li
              key={s.title}
              aria-current={i === current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                i === current && 'border-primary bg-primary text-primary-foreground',
                i < current && 'text-muted-foreground'
              )}
            >
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                {i < current ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span>
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
                {i < current && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{step.title}</h2>
          </CardTitle>
          {step.description && <CardDescription>{step.description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={onBack} disabled={current === 0 || busy}>
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            {step.optional && onSkip && (
              <Button variant="outline" onClick={onSkip} disabled={busy}>
                Skip
              </Button>
            )}
            <Button onClick={onNext} disabled={!canContinue || busy}>
              {isLast ? finishLabel : 'Continue'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
