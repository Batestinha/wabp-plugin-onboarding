import { z } from 'zod';

const chatIds = z.array(z.string().trim().min(1)).default([]);

export const onboardingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Groups whose arrivals never count as arriving in the scope. */
  exemptGroupChatIds: chatIds,
  welcome: z.object({
    /** Empty uses the built-in, translated welcome. Placeholders: {name}, {scope}. */
    text: z.string().max(2000).default('')
  }).strict().default({}),
  rules: z.object({
    /** Shown to newcomers and with /rules. Empty: no rules section. */
    text: z.string().max(4000).default('')
  }).strict().default({}),
  guide: z.object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().int().min(1).max(50).default(12),
    includeFamilies: z.array(z.string().trim().min(1)).default([]),
    excludeFamilies: z.array(z.string().trim().min(1)).default([])
  }).strict().default({}),
  invitation: z.object({
    enabled: z.boolean().default(false),
    /** Operator text, for example how and where to create an account. Placeholders: {name}, {scope}. */
    text: z.string().max(2000).default(''),
    /** Skip it for people whose identity already has a linked sign-in account. */
    skipLinked: z.boolean().default(true)
  }).strict().default({}),
  catchUp: z.object({
    /** Opening of the late welcome for people who were already here. Empty uses the built-in text. Placeholders: {name}, {scope}. */
    intro: z.string().max(2000).default(''),
    batchSize: z.number().int().min(1).max(20).default(3),
    intervalMinutes: z.number().int().min(1).max(240).default(5),
    /** Local hours (scope time zone) during which late welcomes may go out. */
    sendFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).default('10:00'),
    sendUntil: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).default('20:00')
  }).strict().default({}),
  welcomeBack: z.object({
    enabled: z.boolean().default(true),
    /** Empty uses the built-in, translated text. Placeholders: {name}, {scope}. */
    text: z.string().max(1000).default(''),
    /** Only after leaving every group of the scope for at least this long. */
    minAbsenceDays: z.number().int().min(0).max(3650).default(30)
  }).strict().default({})
}).strict();

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;

export function parseOnboardingConfig(input: unknown): OnboardingConfig {
  return onboardingConfigSchema.parse(input ?? {});
}

export function onboardingConfigPaths(): string[] {
  const paths: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
      return;
    }
    paths.push(prefix);
  };
  walk(onboardingConfigSchema.parse({}), '');
  return paths;
}
