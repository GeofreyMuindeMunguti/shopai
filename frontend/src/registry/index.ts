/**
 * Default Component Registry
 *
 * Registers all built-in engine components
 */

import { toast } from 'sonner';
import { createRegistry, setGlobalRegistry } from './createRegistry';
import { registerActionHandler } from '@/engine/ActionDispatcher';
import type { ComponentRegistry, RegisteredComponent } from '@/engine/types';

// Import all engine components
import {
  Stack,
  Grid,
  Container,
  Card,
  Text,
  Heading,
  Input,
  Select,
  Checkbox,
  Textarea,
  Button,
  Link,
  Alert,
  Skeleton,
  Badge,
  CandidateCard,
  ModelSelector,
  RetailerProgress,
  PriceWithConversion,
  Switch,
  FormattedText,
} from '@/components/engine';

/**
 * Create and initialize the default component registry
 */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = createRegistry({
    // Layout
    Stack,
    Grid,
    Container,
    Card,

    // Typography
    Text,
    Heading,
    FormattedText,

    // Forms
    Input,
    Select,
    Checkbox,
    Textarea,
    Switch,

    // Actions
    Button,
    // EngineLink requires `to`; JSON definitions always supply it.
    Link: Link as unknown as RegisteredComponent,

    // Feedback
    Alert,
    Skeleton,

    // Data
    Badge,

    // Scout domain components
    CandidateCard,
    ModelSelector,
    RetailerProgress,
    PriceWithConversion,
  });

  return registry;
}

/**
 * Initialize the global registry with default components
 */
export function initializeRegistry(): ComponentRegistry {
  const registry = createDefaultRegistry();
  setGlobalRegistry(registry);

  // { "action": "custom", "handler": "toast", "payload": { "type": "error", "title": "…", "description": "…" } }
  registerActionHandler('toast', (payload) => {
    const p = (payload ?? {}) as { type?: 'success' | 'error' | 'info'; title?: string; description?: string };
    const fn = p.type === 'error' ? toast.error : p.type === 'success' ? toast.success : toast;
    fn(p.title ?? '', { description: p.description });
  });

  return registry;
}

// Re-export registry utilities
export { getGlobalRegistry, registerComponent, getComponent } from './createRegistry';
