import { ProviderConfig } from "../core/types.js";
import { LLMProvider } from "./base.js";
import { JsonCliProvider } from "./json-cli.js";

const PROVIDERS_BY_TYPE: Record<string, LLMProvider> = {
  [JsonCliProvider.id]: JsonCliProvider
};

export function resolveProvider(config?: ProviderConfig): LLMProvider | undefined {
  if (!config) {
    return undefined;
  }
  const type = config.type ?? JsonCliProvider.id;
  return PROVIDERS_BY_TYPE[type];
}
