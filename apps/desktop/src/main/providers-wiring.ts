import { providers as contracts } from "@autoappz/contracts";
import { ProviderRegistry, type ProviderSettingsStore, type UsageRecorder } from "@autoappz/ai-providers";
import type { CommandBusHost } from "@autoappz/command-bus";
import type { Logger } from "@autoappz/diagnostics";
import type { SecretService } from "@autoappz/secrets";
import type { SettingsRepository, UsageRecordsRepository } from "@autoappz/storage";

const PROVIDER_SETTINGS_KEY = "providers";

export function createProviderSettingsStore(repo: SettingsRepository): ProviderSettingsStore {
  return {
    get: () => repo.get(PROVIDER_SETTINGS_KEY, contracts.ProviderSettingsSchema),
    set: (next) => {
      repo.set(PROVIDER_SETTINGS_KEY, contracts.ProviderSettingsSchema.parse(next));
    },
  };
}

export function createUsageRecorder(repo: UsageRecordsRepository): UsageRecorder {
  return {
    record: (entry) => {
      repo.insert({
        id: entry.id,
        taskId: entry.taskId,
        providerId: entry.providerId,
        modelId: entry.modelId,
        inputTokens: entry.usage.inputTokens,
        outputTokens: entry.usage.outputTokens,
        estimatedCostUsd: entry.estimatedCostUsd,
        at: entry.at,
      });
    },
  };
}

export function createProviderRegistry(input: {
  settingsRepo: SettingsRepository;
  usageRepo: UsageRecordsRepository;
  secrets: SecretService;
  logger: Logger;
  now?: (() => number) | undefined;
}): ProviderRegistry {
  return new ProviderRegistry({
    settings: createProviderSettingsStore(input.settingsRepo),
    resolveSecret: (id) => input.secrets.resolve({ id }),
    usage: createUsageRecorder(input.usageRepo),
    logger: input.logger,
    now: input.now,
  });
}

export function registerProviderHandlers(
  bus: CommandBusHost,
  registry: ProviderRegistry,
  usageRepo: UsageRecordsRepository,
): void {
  bus.handle(contracts.providersList, () => registry.list());
  bus.handle(contracts.providersConfigure, (input) => registry.configure(input));
  bus.handle(contracts.providersValidate, ({ providerId }, ctx) => registry.validate(providerId, ctx.signal));
  bus.handle(contracts.providersModels, ({ providerId, onlyReady }) =>
    registry.models(providerId, onlyReady),
  );
  bus.handle(contracts.providersSettingsGet, () => registry.getSettings());
  bus.handle(contracts.providersSettingsUpdate, (input) => registry.updateSettings(input));
  bus.handle(contracts.providersRoute, ({ intent, complexity }) => registry.route({ intent, complexity }));
  bus.handle(contracts.usageSummary, (filter) => usageRepo.summary(filter));
}
